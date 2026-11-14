import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("Missing server configuration: " + name);
  return value;
}
function pemToBytes(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "").replaceAll(" ", "").replaceAll("\n", "").replaceAll("\r", "").replaceAll("\t", "");
  const binary = atob(body);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
async function verifyQiSignature(payload: Record<string, unknown>, signature: string, pem: string) {
  const key = await crypto.subtle.importKey("spki", pemToBytes(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount)) return false;
  const signedData = [
    payload.paymentId || "-", amount.toFixed(3), payload.currency || "-",
    payload.creationDate || "-", payload.status || "-",
  ].join("|");
  const signatureBytes = Uint8Array.from(atob(signature), (char) => char.charCodeAt(0));
  return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signatureBytes,
    new TextEncoder().encode(signedData));
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const payload = JSON.parse(await req.text()) as Record<string, unknown>;
    const signature = req.headers.get("X-Signature") ?? "";
    if (!signature) return json({ error: "missing_signature" }, 401);
    if (!(await verifyQiSignature(payload, signature, requiredEnv("QICARD_WEBHOOK_PUBLIC_KEY")))) {
      return json({ error: "invalid_signature" }, 401);
    }
    const paymentId = String(payload.paymentId ?? "");
    const requestId = String(payload.requestId ?? "");
    const status = String(payload.status ?? "");
    if (!paymentId || !requestId) return json({ error: "invalid_payload" }, 400);
    const supabase = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: payment, error: paymentError } = await supabase.from("subscription_payments")
      .select("id,amount,currency,merchant_request_id,gateway_payment_id,status")
      .eq("merchant_request_id", requestId).maybeSingle();
    if (paymentError || !payment) return json({ error: "payment_not_found" }, 404);
    if (payment.status === "paid") return json({ ok: true, alreadyProcessed: true });
    if (payment.gateway_payment_id && payment.gateway_payment_id !== paymentId) {
      return json({ error: "payment_reference_mismatch" }, 409);
    }
    const apiBase = Deno.env.get("QICARD_API_BASE_URL") || "https://uat-sandbox-3ds-api.qi.iq/api/v1";
    const basic = btoa(requiredEnv("QICARD_USERNAME") + ":" + requiredEnv("QICARD_PASSWORD"));
    const statusResponse = await fetch(apiBase + "/payment/" + encodeURIComponent(paymentId) + "/status", {
      headers: {
        "Authorization": "Basic " + basic,
        "X-Terminal-Id": requiredEnv("QICARD_TERMINAL_ID"), "Accept": "application/json",
      },
    });
    const confirmed = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok) return json({ error: "gateway_status_unavailable" }, 502);
    if (String(confirmed.paymentId ?? "") !== paymentId ||
        String(confirmed.requestId ?? "") !== requestId ||
        Number(confirmed.amount) !== Number(payment.amount) ||
        String(confirmed.currency ?? "") !== payment.currency) {
      return json({ error: "gateway_payment_mismatch" }, 409);
    }
    const { error: finalizeError } = await supabase.rpc("finalize_qicard_subscription_payment", {
      p_merchant_request_id: requestId,
      p_gateway_payment_id: paymentId,
      p_confirmed_amount: Number(confirmed.amount),
      p_currency: String(confirmed.currency),
      p_gateway_status: String(confirmed.status ?? status),
      p_gateway_payload: { webhook: payload, confirmed },
    });
    if (finalizeError) {
      console.error("[qicard-webhook-finalize]", finalizeError);
      return json({ error: "subscription_activation_failed" }, 500);
    }
    return json({ ok: true });
  } catch (error) {
    console.error("[qicard-webhook]", error);
    return json({ error: "webhook_processing_failed" }, 500);
  }
});