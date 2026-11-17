import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGovernorate, governorateBounds, isInGovernorate } from "@/lib/governorates";

type MapSuggestion = {
  id: string;
  text: string;
  address: string;
  coords: { lat: number; lng: number };
};

type PhotonFeature = {
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: number[] };
};

function normalizedQuery(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ar");
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueParts(values: unknown[]) {
  return [...new Set(values.map(textValue).filter(Boolean))];
}

async function readSuggestions(governorateKey: string, query: string, limit: number) {
  const { data, error } = await (supabaseAdmin as any).rpc("search_map_place_suggestions", {
    p_governorate_key: governorateKey,
    p_query: query,
    p_limit: limit,
  });
  if (error) {
    console.error("[map suggestions] Supabase search failed", error.code || "unknown");
    throw new Error("تعذّر تحميل اقتراحات الأماكن من قاعدة البيانات.");
  }
  return (data ?? []).map((row: any): MapSuggestion => ({
    id: `db:${row.id}`,
    text: row.name_ar,
    address: row.address || row.name_ar,
    coords: { lat: Number(row.latitude), lng: Number(row.longitude) },
  }));
}

async function fetchPhotonSuggestions(query: string, governorateKey: string) {
  const governorate = getGovernorate(governorateKey);
  if (!governorate) throw new Error("المحافظة المختارة غير صحيحة.");
  const bounds = governorateBounds(governorateKey);
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("lang", "ar");
  url.searchParams.set("limit", "30");
  url.searchParams.set("countrycode", "IQ");
  url.searchParams.set(
    "bbox",
    [
      bounds.low.longitude,
      bounds.low.latitude,
      bounds.high.longitude,
      bounds.high.latitude,
    ].join(","),
  );
  url.searchParams.set("lat", String(governorate.lat));
  url.searchParams.set("lon", String(governorate.lng));
  url.searchParams.set("zoom", "12");

  const response = await fetch(url, {
    headers: {
      Accept: "application/geo+json",
      "User-Agent": "Mamnoon/1.0 (https://mamnoon-theta.vercel.app)",
    },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) {
    console.warn("[map suggestions] Photon request failed", response.status);
    return [];
  }
  const result = await response.json() as { features?: PhotonFeature[] };
  const rows = (result.features ?? []).flatMap((feature): any[] => {
    const properties = feature.properties ?? {};
    const coordinates = feature.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
    const longitude = Number(coordinates[0]);
    const latitude = Number(coordinates[1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    if (!isInGovernorate({ lat: latitude, lng: longitude }, governorateKey)) return [];

    const name = textValue(properties.name) ||
      textValue(properties.city) ||
      textValue(properties.district) ||
      textValue(properties.street);
    if (!name) return [];
    const address = uniqueParts([
      properties.housenumber && properties.street
        ? `${textValue(properties.housenumber)} ${textValue(properties.street)}`
        : properties.street,
      properties.suburb,
      properties.district,
      properties.city,
      properties.county,
      properties.state,
      properties.country,
    ]).join("، ") || name;
    const searchTerms = uniqueParts([
      name,
      properties.name_en,
      properties.street,
      properties.suburb,
      properties.district,
      properties.city,
      properties.county,
      properties.state,
      properties.country,
      properties.osm_key,
      properties.osm_value,
    ]).join(" ");
    const osmType = textValue(properties.osm_type) || "P";
    const osmId = textValue(properties.osm_id) || `${latitude.toFixed(6)}:${longitude.toFixed(6)}`;
    return [{
      governorate_key: governorateKey,
      source: "photon",
      source_key: `photon:${osmType}:${osmId}`,
      name_ar: name,
      address,
      search_terms: searchTerms,
      latitude,
      longitude,
      is_active: true,
      updated_at: new Date().toISOString(),
    }];
  });
  return rows;
}

export async function searchMapPlaceSuggestions(input: string, governorateKey: string): Promise<{ suggestions: MapSuggestion[]; attribution: string }> {
  const query = input.trim();
  const governorate = getGovernorate(governorateKey);
  if (!governorate) throw new Error("اختر المحافظة أولاً حتى تظهر اقتراحاتها فقط.");
  if (query.length < 2) return { suggestions: [], attribution: "بيانات الأماكن © OpenStreetMap" };

  const normalized = normalizedQuery(query);
  const [cached, initial] = await Promise.all([
    (supabaseAdmin as any)
      .from("map_place_search_cache")
      .select("expires_at")
      .eq("governorate_key", governorateKey)
      .eq("normalized_query", normalized)
      .maybeSingle(),
    readSuggestions(governorateKey, query, 30),
  ]);
  if (cached.error) {
    console.warn("[map suggestions] cache read failed", cached.error.code || "unknown");
  }

  const cacheFresh = cached.data?.expires_at && new Date(cached.data.expires_at).getTime() > Date.now();
  if (!cacheFresh && initial.length < 20) {
    try {
      const remoteRows = await fetchPhotonSuggestions(query, governorateKey);
      if (remoteRows.length) {
        const { error: upsertError } = await (supabaseAdmin as any)
          .from("map_place_suggestions")
          .upsert(remoteRows, { onConflict: "governorate_key,source_key" });
        if (upsertError) {
          console.error("[map suggestions] Supabase save failed", upsertError.code || "unknown");
          throw new Error("تعذّر حفظ اقتراحات الأماكن في قاعدة البيانات.");
        }
      }
      await (supabaseAdmin as any)
        .from("map_place_search_cache")
        .upsert({
          governorate_key: governorateKey,
          normalized_query: normalized,
          expires_at: new Date(Date.now() + (remoteRows.length ? 7 : 0.25) * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "governorate_key,normalized_query" });
    } catch (error) {
      console.warn("[map suggestions] provider fallback unavailable", error instanceof Error ? error.message : "unknown");
      // Previously saved Supabase results remain available during a provider outage.
    }
  }

  const suggestions = await readSuggestions(governorateKey, query, 20);
  return { suggestions: suggestions.length ? suggestions : initial.slice(0, 20), attribution: "بيانات الأماكن © OpenStreetMap" };
}
