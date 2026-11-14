import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("Missing server configuration: " + name);
  return value;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const authorization = req.headers.get("Authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token || token === authorization) return json({ error: "unauthorized" }, 401);
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "unauthorized" }, 401);
    const userId = authData.user.id;
    const body = await req.json().catch(() => ({}));
    const planCode = String(body.planCode ?? "");
    const billingCycle = String(body.billingCycle ?? "monthly");
    if (!["bronze", "silver", "gold"].includes(planCode) || billingCycle !== "monthly") {
      return json({ error: "invalid_plan_or_cycle" }, 400);
    }
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const [{ data: roles, error: roleError }, { data: plan, error: planError }] = await Promise.all([
      admin.from("user_roles").select("role").eq("user_id", userId),
      admin.from("subscription_plans").select("id,code,name_ar,monthly_price,currency,is_active")
        .eq("code", planCode).eq("is_active", true).maybeSingle(),
    ]);
    if (roleError) throw roleError;
    const roleNames = (roles ?? []).map((r: { role: string }) => r.role);
    if (!roleNames.some((r: string) => ["worker", "driver", "large_driver"].includes(r))) {
      return json({ error: "provider_account_required" }, 403);
    }
    if (planError || !plan || Number(plan.monthly_price) <= 0 || plan.currency !== "IQD") {
      return json({ error: "plan_unavailable" }, 400);
    }
    const requestId = crypto.randomUUID();
    const amount = Number(plan.monthly_price);
    const { error: insertError } = await admin.from("subscription_payments").insert({
      user_id: userId, plan_id: plan.id, amount, currency: "IQD",
      billing_cycle: "monthly", status: "pending", provider: "qicard",
      merchant_request_id: requestId, gateway_status: "CREATING",
      metadata: { plan_code: planCode, plan_name_ar: plan.name_ar },
    });
    if (insertError) throw insertError;
    const apiBase = Deno.env.get("QICARD_API_BASE_URL") || "https://uat-sandbox-3ds-api.qi.iq/api/v1";
    const basic = btoa(requiredEnv("QICARD_USERNAME") + ":" + requiredEnv("QICARD_PASSWORD"));
    const gatewayResponse = await fetch(apiBase + "/payment", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + basic,
        "X-Terminal-Id": requiredEnv("QICARD_TERMINAL_ID"),
        "Content-Type": "application/json", "Accept": "application/json",
      },
      body: JSON.stringify({
        requestId, amount, currency: "IQD", locale: "ar_IQ",
        finishPaymentUrl: requiredEnv("QICARD_FINISH_PAYMENT_URL"),
        notificationUrl: Deno.env.get("QICARD_NOTIFICATION_URL") || "https://enteiolvirenbhkyskgb.supabase.co/functions/v1/qicard-webhook",
        appChannel: body.appChannel === true,
        additionalInfo: { product: "mamnoon_subscription", userId, planCode },
      }),
    });
    const gateway = await gatewayResponse.json().catch(() => ({}));
    if (!gatewayResponse.ok || !gateway.paymentId || !gateway.formUrl) {
      await admin.from("subscription_payments").update({
        status: "failed", gateway_status: "CREATE_FAILED",
        failure_code: String(gateway?.error?.code ?? gatewayResponse.status),
        metadata: { plan_code: planCode, gateway_error: gateway },
      }).eq("merchant_request_id", requestId);
      return json({ error: "gateway_payment_creation_failed" }, 502);
    }
    const { error: updateError } = await admin.from("subscription_payments").update({
      gateway_payment_id: String(gateway.paymentId),
      gateway_status: String(gateway.status ?? "CREATED"),
      metadata: { plan_code: planCode, gateway_payment_id: gateway.paymentId },
    }).eq("merchant_request_id", requestId);
    if (updateError) throw updateError;
    return json({
      requestId, paymentId: gateway.paymentId, checkoutUrl: gateway.formUrl,
      amount, currency: "IQD", planName: plan.name_ar,
    });
  } catch (error) {
    console.error("[qicard-create-payment]", error);
    return json({ error: "payment_initialization_failed" }, 500);
  }
});