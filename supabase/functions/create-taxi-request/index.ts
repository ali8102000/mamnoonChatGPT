import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN");

function createSupabaseFetch(apiKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (
      (apiKey.startsWith("sb_publishable_") || apiKey.startsWith("sb_secret_")) &&
      headers.get("Authorization") === `Bearer ${apiKey}`
    ) headers.delete("Authorization");
    headers.set("apikey", apiKey);
    return fetch(input, { ...init, headers });
  };
}
const corsHeaders = {
  ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
  "Vary": "Origin",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Apikey, X-Client-Info",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fareFor(category: "economy" | "premium" | "luxury", distanceKm: number) {
  void category;
  return Math.max(1000, Math.round((distanceKm * 400) / 250) * 250);
}

function validCoordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const googleMapsApiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !googleMapsApiKey) {
      return json({ error: "إعدادات إنشاء طلب التكسي غير مكتملة على الخادم." }, 503);
    }

    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "يلزم تسجيل الدخول." }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization }, fetch: createSupabaseFetch(anonKey) },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "جلسة الدخول غير صالحة." }, 401);

    const { data: isCustomer, error: roleError } = await userClient.rpc("has_role", {
      _user_id: authData.user.id,
      _role: "customer",
    });
    if (roleError || !isCustomer) return json({ error: "هذا الحساب غير مهيأ لطلب الرحلات." }, 403);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      global: { fetch: createSupabaseFetch(serviceRoleKey) },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await req.json();
    const pickupLat = body?.pickupLat;
    const pickupLng = body?.pickupLng;
    const destinationLat = body?.destinationLat;
    const destinationLng = body?.destinationLng;
    const pickupText = typeof body?.pickupText === "string" ? body.pickupText.trim() : "";
    const destinationText = typeof body?.destinationText === "string" ? body.destinationText.trim() : "";
    const category = body?.vehicleCategory;
    const notes = typeof body?.notes === "string" ? body.notes.trim() : "";

    if (!validCoordinate(pickupLat, -90, 90) || !validCoordinate(pickupLng, -180, 180)
      || !validCoordinate(destinationLat, -90, 90) || !validCoordinate(destinationLng, -180, 180)
      || pickupText.length < 2 || pickupText.length > 300
      || destinationText.length < 2 || destinationText.length > 300
      || !["economy", "premium", "luxury"].includes(category)
      || notes.length > 500) {
      return json({ error: "بيانات الانطلاق أو الوجهة غير صحيحة." }, 400);
    }

    const routeResponse = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "X-Goog-Api-Key": googleMapsApiKey,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: pickupLat, longitude: pickupLng } } },
        destination: { location: { latLng: { latitude: destinationLat, longitude: destinationLng } } },
        travelMode: "DRIVE",
        regionCode: "IQ",
        languageCode: "ar",
      }),
    });
    if (!routeResponse.ok) return json({ error: "تعذر حساب مسافة الطريق؛ لم ننشئ الطلب." }, 502);

    const routeData = await routeResponse.json();
    const route = routeData?.routes?.[0];
    const distanceKm = Number(route?.distanceMeters ?? 0) / 1000;
    const durationMin = Number.parseFloat(String(route?.duration ?? "0s")) / 60;
    if (!Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > 1500
      || !Number.isFinite(durationMin) || durationMin <= 0 || durationMin > 2880) {
      return json({ error: "لم نحصل على مسار طريق صالح؛ تحقق من الوجهة." }, 422);
    }

    const fare = fareFor(category, distanceKm);

    // Consume the atomic request slot only after payload and route validation.
    // Invalid coordinates or unavailable routes must not exhaust a customer's quota.
    const { data: allowed, error: rateLimitError } = await admin.rpc("consume_taxi_request_slot", {
      _user_id: authData.user.id,
    });
    if (rateLimitError) return json({ error: "تعذر التحقق من عدد الطلبات؛ حاول مرة أخرى." }, 500);
    if (!allowed) return json({ error: "وصلت للحد المؤقت لطلبات التكسي. انتظر دقيقة وحاول مجدداً." }, 429);

    const { data: request, error: insertError } = await admin
      .from("service_requests")
      .insert({
        customer_id: authData.user.id,
        type: "taxi",
        status: "pending",
        vehicle_category: category,
        pickup_text: pickupText,
        pickup_lat: pickupLat,
        pickup_lng: pickupLng,
        dest_text: destinationText,
        dest_lat: destinationLat,
        dest_lng: destinationLng,
        distance_km: Number(distanceKm.toFixed(2)),
        duration_min: Math.ceil(durationMin),
        price_estimate: fare,
        notes: notes || null,
      })
      .select("id")
      .single();

    if (insertError || !request) {
      console.error("[create-taxi-request]", insertError?.message ?? "insert returned no row");
      return json({ error: "تعذر حفظ طلب التكسي." }, 500);
    }

    return json({
      requestId: request.id,
      distanceKm,
      durationMin,
      fare,
    });
  } catch (error) {
    console.error("[create-taxi-request]", error instanceof Error ? error.message : "unknown error");
    return json({ error: "تعذر إنشاء طلب التكسي حالياً." }, 500);
  }
});
