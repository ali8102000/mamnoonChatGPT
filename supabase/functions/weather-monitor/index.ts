import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
function getSupabaseSecretKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.default === "string" && parsed.default.trim()) return parsed.default.trim();
    } catch { /* use legacy fallback below */ }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!legacy) throw new Error("missing_supabase_secret_key");
  return legacy;
}
function createSupabaseFetch(apiKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined);
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if ((apiKey.startsWith("sb_publishable_") || apiKey.startsWith("sb_secret_")) && headers.get("Authorization") === `Bearer ${apiKey}`) headers.delete("Authorization");
    headers.set("apikey", apiKey);
    return fetch(input, { ...init, headers });
  };
}

const CITIES = [
  ["baghdad",33.3152,44.3661],["basra",30.5085,47.7804],["nineveh",36.34,43.13],
  ["erbil",36.1911,44.0092],["sulaymaniyah",35.5613,45.4306],["duhok",36.8669,42.9503],
  ["kirkuk",35.4681,44.3922],["najaf",32.0259,44.3462],["karbala",32.616,44.0249],
  ["babil",32.4637,44.4196],["anbar",33.4206,43.3058],["diyala",33.7502,44.6066],
  ["saladin",34.6,43.68],["wasit",32.5128,45.8182],["dhiqar",31.0439,46.2573],
  ["maysan",31.8356,47.1449],["muthanna",31.3099,45.2803],["qadisiyah",31.9929,44.925],
] as const;

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const serviceKey = getSupabaseSecretKey();
  if (!serviceKey || req.headers.get("apikey") !== serviceKey) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const weatherKey = Deno.env.get("WEATHERAPI_KEY") ?? Deno.env.get("WEATHERAPI_API_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  if (!weatherKey || !url || !serviceKey) {
    return Response.json({ error: "weather_provider_not_configured" }, { status: 503 });
  }

  const admin = createClient(url, serviceKey, {
    global: { fetch: createSupabaseFetch(serviceKey) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: settings, error: settingsError } = await admin
    .from("taxi_peak_weather_settings")
    .select("governorate_key,weather_max_age_minutes")
    .in("governorate_key", CITIES.map(([key]) => key));
  if (settingsError) return Response.json({ error: "weather_settings_unavailable" }, { status: 503 });

  const settingsByKey = new Map((settings ?? []).map((row: any) => [row.governorate_key, row]));
  const results: any[] = [];
  for (let start = 0; start < CITIES.length; start += 3) {
    const batch = CITIES.slice(start, start + 3);
    const settled = await Promise.all(batch.map(async ([governorateKey, lat, lon]) => {
      const setting: any = settingsByKey.get(governorateKey) ?? {};
      const endpoint = new URL("https://api.weatherapi.com/v1/forecast.json");
      endpoint.searchParams.set("key", weatherKey);
      endpoint.searchParams.set("q", `${lat},${lon}`);
      endpoint.searchParams.set("days", "1");
      endpoint.searchParams.set("alerts", "yes");
      endpoint.searchParams.set("aqi", "no");
      try {
        const response = await fetch(endpoint, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`WeatherAPI HTTP ${response.status}`);
        const payload = await response.json() as any;
        const current = payload.current;
        const observedAt = Number(current?.last_updated_epoch);
        const temp = Number(current?.temp_c);
        const rain = Number(current?.precip_mm);
        if (!Number.isFinite(observedAt) || !Number.isFinite(temp) || !Number.isFinite(rain)) {
          throw new Error("weather_payload_incomplete");
        }
        const observed = new Date(observedAt * 1000);
        const ageMinutes = (Date.now() - observed.getTime()) / 60000;
        const freshnessLimit = Math.max(20, Number(setting.weather_max_age_minutes) || 30);
        // Reject materially future-dated provider readings instead of clamping them to age zero.
        const isFresh = ageMinutes >= -2 && ageMinutes <= freshnessLimit;
        const alerts = Array.isArray(payload.alerts?.alert) ? payload.alerts.alert.slice(0, 10).map((a: any) => ({
          headline: String(a.headline ?? "").slice(0, 240),
          severity: String(a.severity ?? "").slice(0, 40),
          event: String(a.event ?? "").slice(0, 100),
          effective: a.effective ?? null,
          expires: a.expires ?? null,
        })) : [];
        const row = {
          governorate_key: governorateKey,
          temperature_c: temp,
          rain_mm: rain,
          condition_text: String(current.condition?.text ?? "").slice(0, 120),
          observed_at: observed.toISOString(),
          fetched_at: new Date().toISOString(),
          provider: "weatherapi",
          is_fresh: isFresh,
          error: isFresh ? null : ageMinutes < -2 ? "توقيت قراءة الطقس يقع في المستقبل" : "قراءة الطقس أقدم من الحد المسموح",
          alerts,
        };
        const { error } = await admin.from("taxi_peak_weather_observations").upsert(row, { onConflict: "governorate_key" });
        if (error) throw new Error("weather_observation_write_failed");
        await admin.from("taxi_peak_weather_settings").update({
          weather_monitor_ready: row.is_fresh,
          last_checked_at: new Date().toISOString(),
          last_reason: row.is_fresh ? "تم استلام قراءة طقس حقيقية وحديثة من WeatherAPI" : ageMinutes < -2 ? "توقيت قراءة الطقس في المستقبل؛ تم رفضها" : "وصلت قراءة قديمة؛ لا تستخدم للتشغيل",
        }).eq("governorate_key", governorateKey);
        return { governorate_key: governorateKey, ok: true, fresh: row.is_fresh, age_minutes: Math.round(ageMinutes), alerts: alerts.length };
      } catch (error) {
        const message = error instanceof Error ? error.message : "weather_fetch_failed";
        await admin.from("taxi_peak_weather_observations").upsert({
          governorate_key: governorateKey,
          provider: "weatherapi",
          fetched_at: new Date().toISOString(),
          is_fresh: false,
          error: message.slice(0, 240),
          alerts: [],
        }, { onConflict: "governorate_key" });
        await admin.from("taxi_peak_weather_settings").update({
          last_checked_at: new Date().toISOString(),
          weather_monitor_ready: false,
          last_reason: "تعذر جلب قراءة الطقس؛ تم منع استخدام بيانات غير مؤكدة",
        }).eq("governorate_key", governorateKey);
        return { governorate_key: governorateKey, ok: false, error: message.slice(0, 120) };
      }
    }));
    results.push(...settled);
  }
  const succeeded = results.filter((r) => r.ok).length;
  const allFresh = succeeded === CITIES.length && results.every((r) => r.ok && r.fresh === true);
  await admin.from("taxi_peak_weather_settings").update({
    weather_monitor_ready: allFresh,
    last_checked_at: new Date().toISOString(),
    last_reason: allFresh
      ? "توجد قراءات طقس حديثة لجميع المحافظات"
      : `قراءات حديثة جزئية فقط: ${succeeded} من ${CITIES.length} محافظة؛ يمنع التفعيل الشامل`,
  }).eq("governorate_key", "all");
  return Response.json({
    ok: allFresh,
    provider: "WeatherAPI",
    checked: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  }, { status: allFresh ? 200 : 207 });
});
