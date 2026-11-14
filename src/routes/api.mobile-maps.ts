import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getGovernorate, governorateBounds, governorateOf, isInGovernorate } from "@/lib/governorates";
import { parseDrivingRoute } from "@/lib/route-distance";

const coords = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("autocomplete"),
    input: z.string().trim().min(2).max(160),
    center: coords,
    governorateKey: z.string().optional(),
  }),
  z.object({
    action: z.literal("details"),
    placeId: z.string().regex(/^[A-Za-z0-9_-]+$/).max(300),
  }),
  z.object({ action: z.literal("reverse"), center: coords }),
  z.object({ action: z.literal("validateGovernorate"), center: coords, governorateKey: z.string().min(2).max(40) }),
  z.object({ action: z.literal("detectGovernorate"), center: coords }),
  z.object({ action: z.literal("route"), from: coords, to: coords }),
  z.object({
    action: z.literal("createTaxiRequest"),
    from: coords,
    to: coords,
    pickupText: z.string().trim().min(2).max(500),
    destinationText: z.string().trim().min(2).max(500),
    pickupGovernorateKey: z.string().optional(),
    destinationGovernorateKey: z.string().optional(),
    vehicleCategory: z.enum(["economy", "premium", "luxury"]),
    notes: z.string().max(1000).optional().default(""),
  }),
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function googleConfig() {
  const apiKey = process.env["GOOGLE_MAPS_API_KEY"];
  const lovableKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey || !lovableKey) {
    throw new Error("خدمة الخرائط غير مهيأة على الخادم حالياً.");
  }
  return {
    gateway: "https://connector-gateway.lovable.dev/google_maps",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": apiKey,
      "Content-Type": "application/json",
    } as Record<string, string>,
  };
}

async function googleRequest(path: string, body?: unknown, fieldMask?: string) {
  const config = googleConfig();
  const headers = { ...config.headers };
  if (fieldMask) headers["X-Goog-FieldMask"] = fieldMask;
  const response = await fetch(config.gateway + path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error("[mobile-maps] Google request failed", response.status, detail.slice(0, 500));
    throw new Error(
      response.status === 403
        ? "خدمة الخرائط غير مفعّلة لهذا المفتاح. راجع إعدادات Google Maps."
        : "تعذّر إكمال طلب الخرائط حالياً. حاول مرة ثانية.",
    );
  }
  return response.json() as Promise<Record<string, any>>;
}

async function drivingRoute(from: z.infer<typeof coords>, to: z.infer<typeof coords>) {
  const result = await googleRequest(
    "/routes/directions/v2:computeRoutes",
    {
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: "DRIVE",
    },
    "routes.distanceMeters,routes.duration",
  );
  const route = parseDrivingRoute(result);
  if (route.distanceKm <= 0) throw new Error("لم يتم العثور على طريق صالح بين الموقعين.");
  return route;
}

async function handleRequest(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ error: "سجّل الدخول أولاً." }, 401);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "انتهت جلسة الدخول. سجّل الدخول مرة ثانية." }, 401);

  const raw = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return json({ error: "بيانات البحث أو الموقع غير صحيحة." }, 400);
  const data = parsed.data;

  if (data.action === "autocomplete") {
    const governorate = data.governorateKey ? getGovernorate(data.governorateKey) : null;
    if (data.governorateKey && !governorate) return json({ error: "المحافظة المختارة غير صحيحة." }, 400);

    if (governorate) {
      const bounds = governorateBounds(governorate.key);
      const runSearch = (textQuery: string) =>
        googleRequest(
          "/places/v1/places:searchText",
          {
            textQuery,
            languageCode: "ar",
            regionCode: "IQ",
            pageSize: 20,
            rankPreference: "DISTANCE",
            locationRestriction: { rectangle: { low: bounds.low, high: bounds.high } },
          },
          "places.id,places.displayName,places.formattedAddress,places.location",
        );
      let result = await runSearch(data.input);
      let local = (result.places ?? []).filter((place: any) =>
        place.location &&
        isInGovernorate(
          { lat: place.location.latitude, lng: place.location.longitude },
          governorate.key,
        ),
      );
      if (!local.length) {
        result = await runSearch(`${data.input} ${governorate.name} العراق`);
        local = (result.places ?? []).filter((place: any) =>
          place.location &&
          isInGovernorate(
            { lat: place.location.latitude, lng: place.location.longitude },
            governorate.key,
          ),
        );
      }
      return json({
        suggestions: local.slice(0, 7).map((place: any) => ({
          id: place.id,
          text: place.displayName?.text || place.formattedAddress || "",
          address: place.formattedAddress || place.displayName?.text || "",
          coords: { lat: place.location.latitude, lng: place.location.longitude },
        })),
      });
    }

    const result = await googleRequest(
      "/places/v1/places:autocomplete",
      {
        input: data.input,
        languageCode: "ar",
        includedRegionCodes: ["iq"],
        locationBias: {
          circle: {
            center: { latitude: data.center.lat, longitude: data.center.lng },
            radius: 50000,
          },
        },
      },
      "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
    );
    return json({
      suggestions: (result.suggestions ?? []).flatMap((item: any) =>
        item.placePrediction
          ? [{ id: item.placePrediction.placeId, text: item.placePrediction.text.text }]
          : [],
      ).slice(0, 7),
    });
  }

  if (data.action === "details") {
    const result = await googleRequest(
      `/places/v1/places/${encodeURIComponent(data.placeId)}?languageCode=ar`,
      undefined,
      "location,formattedAddress,displayName",
    );
    if (!result.location) return json({ error: "لم يتوفر موقع لهذا المكان." }, 404);
    return json({
      coords: { lat: result.location.latitude, lng: result.location.longitude },
      address: result.formattedAddress || result.displayName?.text || "",
    });
  }

  if (data.action === "validateGovernorate") {
    const governorate = getGovernorate(data.governorateKey);
    if (!governorate) return json({ error: "المحافظة المختارة غير صحيحة." }, 400);
    return json({ valid: isInGovernorate(data.center, governorate.key) });
  }

  if (data.action === "detectGovernorate") {
    const governorate = governorateOf(data.center);
    return json({ key: governorate.key, name: governorate.name });
  }

  if (data.action === "reverse") {
    const result = await googleRequest(
      `/maps/api/geocode/json?latlng=${data.center.lat},${data.center.lng}&language=ar`,
    );
    if (result.status !== "OK" && result.status !== "ZERO_RESULTS") {
      return json({ error: "تعذّر قراءة عنوان الموقع المحدد." }, 502);
    }
    return json({ address: result.results?.[0]?.formatted_address || "" });
  }

  if (data.action === "route") {
    return json(await drivingRoute(data.from, data.to));
  }

  const rolesResult = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", authData.user.id);
  if (rolesResult.error) return json({ error: "تعذّر التحقق من صلاحيات الحساب." }, 500);
  if (!(rolesResult.data ?? []).some((row: any) => row.role === "customer")) {
    return json({ error: "هذا الحساب غير مهيأ لإنشاء طلبات الزبائن." }, 403);
  }

  const now = new Date().toISOString();
  const { data: blocked, error: blockError } = await supabaseAdmin
    .from("user_blocks")
    .select("user_id")
    .eq("user_id", authData.user.id)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();
  if (blockError) return json({ error: "تعذّر التحقق من حالة الحساب." }, 500);
  if (blocked) return json({ error: "الحساب موقوف حالياً ولا يمكنه إنشاء طلب." }, 403);

  const route = await drivingRoute(data.from, data.to);
  const fromGovernorate = data.pickupGovernorateKey
    ? getGovernorate(data.pickupGovernorateKey)
    : governorateOf(data.from);
  const toGovernorate = data.destinationGovernorateKey
    ? getGovernorate(data.destinationGovernorateKey)
    : governorateOf(data.to);
  if (!fromGovernorate || !toGovernorate) return json({ error: "تعذّر تحديد المحافظتين." }, 400);

  const { data: created, error: createError } = await supabaseAdmin
    .from("service_requests")
    .insert({
      customer_id: authData.user.id,
      type: "taxi",
      status: "pending",
      vehicle_category: data.vehicleCategory,
      pickup_text: data.pickupText,
      pickup_lat: data.from.lat,
      pickup_lng: data.from.lng,
      dest_text: data.destinationText,
      dest_lat: data.to.lat,
      dest_lng: data.to.lng,
      distance_km: route.distanceKm,
      duration_min: route.durationMin,
      is_intercity: fromGovernorate.key !== toGovernorate.key,
      notes: data.notes.trim() || null,
    })
    .select("id,price_estimate,distance_km,duration_min")
    .single();

  if (createError || !created) {
    console.error("[mobile-maps] taxi request insert failed", createError?.code || "unknown", createError?.message || "");
    if (createError?.message?.includes("لديك طلب نشط")) {
      return json({ error: "لديك طلب نشط بالفعل. أنهِه أو ألغِه قبل إنشاء طلب جديد." }, 409);
    }
    return json({ error: "تعذّر إنشاء طلب التكسي. تحقق من المواقع وحاول مرة ثانية." }, 400);
  }

  return json({
    requestId: created.id,
    distanceKm: created.distance_km ?? route.distanceKm,
    durationMin: created.duration_min ?? route.durationMin,
    priceEstimate: created.price_estimate,
  }, 201);
}

export const Route = createFileRoute("/api/mobile-maps")({
  server: {
    handlers: {
      OPTIONS: async () => new Response("ok", { headers: corsHeaders }),
      POST: async ({ request }) => {
        try {
          return await handleRequest(request);
        } catch (error) {
          console.error("[mobile-maps] request failed", error instanceof Error ? error.message : "unknown");
          return json({
            error: error instanceof Error ? error.message : "تعذّر تنفيذ طلب الخرائط.",
          }, 500);
        }
      },
    },
  },
});
