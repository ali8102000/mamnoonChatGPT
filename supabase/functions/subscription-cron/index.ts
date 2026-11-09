import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function createSupabaseFetch(apiKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (apiKey.startsWith("sb_secret_") && headers.get("Authorization") === `Bearer ${apiKey}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", apiKey);
    return fetch(input, { ...init, headers });
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // This job performs privileged subscription expiry and counter resets.
    // Require the service-role bearer token so the public anon key cannot trigger it.
    if (req.headers.get("Authorization") !== `Bearer ${serviceKey}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      global: { fetch: createSupabaseFetch(serviceKey) },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: expiredCount } = await supabase.rpc("handle_expired_subscriptions");

    const warningDays = [7, 3, 1];
    let notifCount = 0;

    for (const days of warningDays) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + days);
      const targetStart = new Date(targetDate);
      targetStart.setHours(0, 0, 0, 0);
      const targetEnd = new Date(targetDate);
      targetEnd.setHours(23, 59, 59, 999);

      const { data: expiring } = await supabase
        .from("user_subscriptions")
        .select(
          `
          id, user_id, current_period_end,
          plan:subscription_plans(name_ar)
        `,
        )
        .eq("status", "active")
        .not("current_period_end", "is", null)
        .gte("current_period_end", targetStart.toISOString())
        .lte("current_period_end", targetEnd.toISOString());

      if (!expiring || expiring.length === 0) continue;

      for (const sub of expiring) {
        const { data: existing } = await supabase
          .from("subscription_expiry_notifications")
          .select("id")
          .eq("subscription_id", sub.id)
          .eq("days_before", days)
          .maybeSingle();

        if (existing) continue;

        const planRelation = sub.plan;
        const plan = Array.isArray(planRelation) ? planRelation[0] : planRelation;
        const planName = typeof plan?.name_ar === "string" ? plan.name_ar : "اشتراكك";
        const notifBody =
          days === 1
            ? `ينتهي ${planName} غداً. جدد الآن للاستمرار في استقبال الطلبات.`
            : `ينتهي ${planName} خلال ${days} أيام. جدد لتجنب العودة للباقة المجانية.`;

        await supabase.from("notifications").insert({
          user_id: sub.user_id,
          type: "subscription_expiring",
          title: "تنبيه: اشتراكك على وشك الانتهاء",
          body: notifBody,
          data: { subscription_id: sub.id, days_before: days },
        });

        await supabase.from("subscription_expiry_notifications").insert({
          user_id: sub.user_id,
          subscription_id: sub.id,
          days_before: days,
        });

        notifCount++;
      }
    }

    const { data: resetCount } = await supabase.rpc("reset_monthly_request_counters");

    return new Response(
      JSON.stringify({
        ok: true,
        expired: expiredCount ?? 0,
        notifications_sent: notifCount,
        counters_reset: resetCount ?? 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[subscription-cron]", err instanceof Error ? err.message : "unknown error");
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
