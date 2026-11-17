import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { GOVERNORATES, getGovernorate, governorateBounds, governorateOf, isInGovernorate } from "@/lib/governorates";
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
    placeId: z.string().regex(/^(db:)?[A-Za-z0-9_-]+$/).max(320),
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
    couponCode: z.string().trim().min(2).max(50).optional(),
    tripType: z.enum(["one_way", "round_trip", "second_trip", "stop"]).optional().default("one_way"),
    extraMinutes: z.number().int().min(0).max(120).refine((value) => value % 5 === 0, "مدة الانتظار يجب أن تكون من مضاعفات 5").optional().default(0),
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
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(to.lat - from.lat);
  const dLng = radians(to.lng - from.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLng / 2) ** 2;
  const fallback = () => {
    const distanceKm = Math.max(0.1, 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 1.35);
    return { distanceKm: Number(distanceKm.toFixed(3)), durationMin: Number((distanceKm / 32 * 60 + 3).toFixed(1)), routeSource: "haversine_fallback" };
  };
  if (!process.env["GOOGLE_MAPS_API_KEY"] || !process.env["LOVABLE_API_KEY"]) return fallback();
  try {
    const result = await googleRequest(
      "/routes/directions/v2:computeRoutes",
      {
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        computeAlternativeRoutes: true,
      },
      "routes.distanceMeters,routes.duration",
    );
    const route = parseDrivingRoute(result);
    return route.distanceKm > 0 ? { ...route, routeSource: "google_routes" } : fallback();
  } catch {
    return fallback();
  }
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
    if (!governorate) return json({ error: "اختر المحافظة أولاً حتى تظهر اقتراحاتها فقط." }, 400);
    const { searchMapPlaceSuggestions } = await import("@/lib/map-place-search.server");
    return json(await searchMapPlaceSuggestions(data.input, governorate.key));
  }

  if (data.action === "details" && data.placeId.startsWith("db:")) {
    const { data: row, error } = await (supabaseAdmin as any)
      .from("map_place_suggestions")
      .select("name_ar,address,latitude,longitude")
      .eq("id", data.placeId.slice(3))
      .maybeSingle();
    if (error || !row) return json({ error: "لم يتم العثور على المكان المحفوظ." }, 404);
    return json({
      coords: { lat: Number(row.latitude), lng: Number(row.longitude) },
      address: row.address || row.name_ar,
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
    const url = new URL("https://photon.komoot.io/reverse");
    url.searchParams.set("lat", String(data.center.lat));
    url.searchParams.set("lon", String(data.center.lng));
    url.searchParams.set("lang", "ar");
    const response = await fetch(url, {
      headers: { Accept: "application/geo+json", "User-Agent": "Mamnoon/1.0 (https://mamnoon-theta.vercel.app)" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return json({ address: "" });
    const result = await response.json() as any;
    const p = result.features?.[0]?.properties ?? {};
    return json({ address: [p.name, p.street, p.district, p.city, p.state, p.country].filter(Boolean).join("، ") });
  }

  if (data.action === "route") {
    const fromGovernorate = GOVERNORATES.find((governorate) => isInGovernorate(data.from, governorate.key));
    const toGovernorate = GOVERNORATES.find((governorate) => isInGovernorate(data.to, governorate.key));
    if (!fromGovernorate || !toGovernorate) {
      return json({ error: "يجب أن تكون نقطتا الانطلاق والوجهة داخل حدود العراق. اختر موقعاً داخل إحدى المحافظات." }, 400);
    }
    const route = await drivingRoute(data.from, data.to);
    return json({
      ...route,
      fromGovernorateKey: fromGovernorate.key,
      toGovernorateKey: toGovernorate.key,
      isIntercity: fromGovernorate.key !== toGovernorate.key,
    });
  }

  if (data.action !== "createTaxiRequest") {
    return json({ error: "نوع طلب الخرائط غير مدعوم." }, 400);
  }

  const supabaseUrl = process.env["MAMNOON_SUPABASE_URL"] || process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
  const supabasePublishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["SUPABASE_ANON_KEY"] || process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!supabaseUrl || !supabasePublishableKey) {
    return json({ error: "خدمة إنشاء الطلب غير مهيأة على الخادم." }, 503);
  }
  const supabaseUser = createClient(supabaseUrl, supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

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
  if (fromGovernorate.key !== toGovernorate.key && !data.destinationGovernorateKey) {
    return json({ error: "أنت خارج محافظتك، يرجى تحديد المحافظة المراد التوجه إليها." }, 400);
  }
  if (
    !isInGovernorate(data.from, fromGovernorate.key) ||
    !isInGovernorate(data.to, toGovernorate.key)
  ) {
    return json({ error: "إحدى نقطتي الرحلة لا تقع داخل المحافظة المختارة. حدّد الموقع من جديد." }, 400);
  }

  const { data: created, error: createError } = await supabaseUser
    .from("service_requests")
    .insert({
      customer_id: authData.user.id,
      governorate_key: fromGovernorate.key,
      coupon_code: data.couponCode?.trim().toUpperCase() || null,
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
      trip_type: data.tripType,
      extra_minutes: data.extraMinutes,
      notes: data.notes.trim() || null,
    } as any)
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
