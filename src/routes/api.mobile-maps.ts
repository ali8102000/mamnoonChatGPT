import { createFileRoute } from "@tanstack/react-router";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

// Temporary compatibility bridge for previously installed Android clients.
// All validation, authentication, governorate checks, place lookup and routing
// now execute in Supabase's maps-proxy Edge Function. No Lovable or service-role
// credentials are used by this Vercel route.
async function forward(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+/i.test(authorization)) {
    return json({ error: "سجّل الدخول أولاً." }, 401);
  }

  const supabaseUrl =
    process.env["MAMNOON_SUPABASE_URL"] ||
    process.env["SUPABASE_URL"] ||
    process.env["VITE_SUPABASE_URL"];
  const publishableKey =
    process.env["MAMNOON_SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["SUPABASE_ANON_KEY"] ||
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

  if (!supabaseUrl || !publishableKey) {
    return json({ error: "خدمة الخرائط غير مهيأة على الخادم." }, 503);
  }

  const response = await fetch(
    supabaseUrl.replace(/\/+$/, "") + "/functions/v1/maps-proxy",
    {
      method: "POST",
      headers: {
        Authorization: authorization,
        apikey: publishableKey,
        "Content-Type": "application/json",
      },
      body: await request.text(),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: { ...corsHeaders, "Content-Type": response.headers.get("content-type") || "application/json; charset=utf-8" },
  });
}

export const Route = createFileRoute("/api/mobile-maps")({
  server: {
    handlers: {
      OPTIONS: async () => new Response("ok", { headers: corsHeaders }),
      POST: async ({ request }) => {
        try {
          return await forward(request);
        } catch (error) {
          console.error("[mobile-maps compatibility bridge] failed", error instanceof Error ? error.message : "unknown");
          return json({ error: "تعذّر الاتصال بخدمة الخرائط. حاول مرة ثانية." }, 502);
        }
      },
    },
  },
});
