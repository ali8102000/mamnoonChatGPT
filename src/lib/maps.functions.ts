import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getGovernorate } from "./governorates";
import { parseDrivingRoute } from "./route-distance";

// The browser key is optional: the map picker falls back to OpenStreetMap tiles.
export const getMapConfig = createServerFn({ method: "GET" }).handler(async () => ({
  browserKey:
    process.env["GOOGLE_MAPS_BROWSER_KEY"] ||
    process.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY"] ||
    "",
  channel: process.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID"] || "mumnun",
}));

const coords = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("autocomplete"),
    input: z.string().trim().min(2).max(200),
    sessionToken: z.string().uuid(),
    center: coords,
    governorateKey: z.string().refine((key) => !!getGovernorate(key)).optional(),
  }),
  z.object({
    action: z.literal("details"),
    placeId: z.string().regex(/^(db:)?[A-Za-z0-9_-]+$/).max(320),
    sessionToken: z.string().uuid(),
  }),
  z.object({ action: z.literal("reverse"), center: coords }),
  z.object({ action: z.literal("route"), from: coords, to: coords }),
]);

function approximateRoute(from: z.infer<typeof coords>, to: z.infer<typeof coords>) {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(to.lat - from.lat);
  const dLng = radians(to.lng - from.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLng / 2) ** 2;
  const distanceKm = Math.max(0.1, 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 1.35);
  return {
    distanceKm: Number(distanceKm.toFixed(3)),
    durationMin: Number((distanceKm / 32 * 60 + 3).toFixed(1)),
    routeSource: "haversine_fallback",
  };
}

async function photonReverse(center: z.infer<typeof coords>) {
  const url = new URL("https://photon.komoot.io/reverse");
  url.searchParams.set("lat", String(center.lat));
  url.searchParams.set("lon", String(center.lng));
  url.searchParams.set("lang", "ar");
  const response = await fetch(url, {
    headers: { Accept: "application/geo+json", "User-Agent": "Mamnoon/1.0 (https://mamnoon-theta.vercel.app)" },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) return { address: "" };
  const result = await response.json() as any;
  const p = result.features?.[0]?.properties ?? {};
  return { address: [p.name, p.street, p.district, p.city, p.state, p.country].filter(Boolean).join("، ") };
}

export const lookupMapPlace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.infer<typeof input>) => input.parse(data))
  .handler(async ({ data }) => {
    if (data.action === "autocomplete") {
      if (!data.governorateKey) throw new Error("اختر المحافظة أولاً حتى تظهر اقتراحاتها فقط.");
      const { searchMapPlaceSuggestions } = await import("./map-place-search.server");
      return searchMapPlaceSuggestions(data.input, data.governorateKey);
    }

    if (data.action === "details" && data.placeId.startsWith("db:")) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: row, error } = await supabaseAdmin
        .from("map_place_suggestions")
        .select("name_ar,address,latitude,longitude")
        .eq("id", data.placeId.slice(3))
        .maybeSingle();
      if (error || !row) throw new Error("لم يتم العثور على المكان المحفوظ.");
      return {
        coords: { lat: Number(row.latitude), lng: Number(row.longitude) },
        address: row.address || row.name_ar,
      };
    }

    const apiKey = process.env["GOOGLE_MAPS_API_KEY"];
    const lovableKey = process.env["LOVABLE_API_KEY"];
    if (data.action === "reverse" && (!apiKey || !lovableKey)) return photonReverse(data.center);
    if (data.action === "route" && (!apiKey || !lovableKey)) return approximateRoute(data.from, data.to);

    const gateway = "https://connector-gateway.lovable.dev/google_maps";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": apiKey!,
      "Content-Type": "application/json",
    };
    let path: string;
    let body: string | undefined;
    if (data.action === "details") {
      path = `/places/v1/places/${encodeURIComponent(data.placeId)}?sessionToken=${data.sessionToken}&languageCode=ar`;
      headers["X-Goog-FieldMask"] = "location,formattedAddress,displayName";
    } else if (data.action === "route") {
      path = "/routes/directions/v2:computeRoutes";
      headers["X-Goog-FieldMask"] = "routes.distanceMeters,routes.duration";
      body = JSON.stringify({
        origin: { location: { latLng: { latitude: data.from.lat, longitude: data.from.lng } } },
        destination: { location: { latLng: { latitude: data.to.lat, longitude: data.to.lng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        computeAlternativeRoutes: true,
      });
    } else {
      path = `/maps/api/geocode/json?latlng=${data.center.lat},${data.center.lng}&language=ar`;
    }

    try {
      const response = await fetch(gateway + path, { method: body ? "POST" : "GET", headers, body });
      if (!response.ok) {
        const details = await response.text();
        console.error(`[Maps ${response.status}] ${details.slice(0, 300)}`);
        if (data.action === "route") return approximateRoute(data.from, data.to);
        if (data.action === "reverse") return photonReverse(data.center);
        throw new Error("تعذّر إكمال طلب الخرائط حالياً. حاول مرة ثانية.");
      }
      const result = await response.json() as any;
      if (data.action === "details") {
        if (!result.location) throw new Error("لا يتوفر موقع لهذا المكان");
        return {
          coords: { lat: result.location.latitude as number, lng: result.location.longitude as number },
          address: (result.formattedAddress || result.displayName?.text || "") as string,
        };
      }
      if (data.action === "route") return parseDrivingRoute(result);
      if (result.status !== "OK" && result.status !== "ZERO_RESULTS") return photonReverse(data.center);
      return { address: (result.results?.[0]?.formatted_address || "") as string };
    } catch (error) {
      if (data.action === "route") return approximateRoute(data.from, data.to);
      if (data.action === "reverse") return photonReverse(data.center);
      throw error;
    }
  });
