import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import { getSupabasePublishableKey, getSupabaseSecretKey, createSupabaseFetch } from "../_shared/api-keys.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const required = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("missing_" + name);
  return value;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const url = required("SUPABASE_URL");
    const publishable = getSupabasePublishableKey();
    const secret = getSupabaseSecretKey();
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\\s+/i, "");
    if (!token || token.length > 8192) return json({ error: "unauthorized" }, 401);

    const caller = createClient(url, publishable, {
      global: { fetch: createSupabaseFetch(publishable), headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await caller.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => null);
    const messageId = typeof body?.message_id === "string" ? body.message_id : "";
    if (!messageId) return json({ error: "invalid_request" }, 400);

    const admin = createClient(url, secret, {
      global: { fetch: createSupabaseFetch(secret) },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: message, error: messageError } = await admin.from("support_messages")
      .select("id,conversation_id,sender_id,body,created_at,is_ai")
      .eq("id", messageId).maybeSingle();
    if (messageError || !message || message.sender_id !== auth.user.id || message.is_ai) {
      return json({ error: "forbidden" }, 403);
    }

    const { data: conversation, error: conversationError } = await admin.from("support_conversations")
      .select("id,user_id,status").eq("id", message.conversation_id).maybeSingle();
    if (conversationError || !conversation || conversation.user_id !== auth.user.id || conversation.status !== "open") {
      return json({ error: "forbidden" }, 403);
    }

    const { data: priorReply } = await admin.from("support_messages")
      .select("id,body,created_at,is_ai").eq("ai_reply_to", messageId).maybeSingle();
    if (priorReply) return json({ ok: true, duplicate: true, reply: priorReply.body });

    const { data: laterStaffMessages, error: laterError } = await admin.from("support_messages")
      .select("id").eq("conversation_id", conversation.id).eq("is_ai", false)
      .neq("sender_id", conversation.user_id).gt("created_at", message.created_at).limit(1);
    if (laterError) return json({ error: "support_state_unavailable" }, 503);
    if ((laterStaffMessages ?? []).length) return json({ ok: true, skipped: "staff_already_replied" });

    const geminiKey = required("GEMINI_API_KEY");
    const model = Deno.env.get("GEMINI_CHAT_MODEL")?.trim() || "gemini-2.5-flash-lite";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`;
    const prompt = [
      "أنت موظف خدمة العملاء الافتراضي في تطبيق ممنون العراقي.",
      "أجب باللهجة العراقية الواضحة والمهذبة وباختصار عن التسجيل واستخدام التطبيق والموقع والطلبات والدفع.",
      "لا تدّعِ أنك نفذت إجراءً أو فتحت حساباً أو ألغيت طلباً أو استرجعت مبلغاً.",
      "لا تخترع سياسات أو أسعاراً أو معلومات غير موجودة في رسالة العميل.",
      "إذا كان الموضوع يتعلق بمدفوعات أو استرداد أو شكوى/تهديد/سلامة أو بيانات حساب خاصة أو يحتاج صلاحية موظف أو لم تكن متأكداً، اجعل handoff=true ولا تعطِ تعليمات تخمينية.",
      "أعد JSON فقط بالشكل: {\"reply\":\"نص الرد\",\"handoff\":false,\"reason\":\"سبب مختصر\"}.",
    ].join("\\n");
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt }] },
        contents: [{ role: "user", parts: [{ text: message.body }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 450, responseMimeType: "application/json" },
      }),
    });
    if (!upstream.ok) {
      console.error("support Gemini failed", upstream.status, (await upstream.text().catch(() => "")).slice(0, 400));
      return json({ error: "ai_provider_unavailable" }, 502);
    }
    const result = await upstream.json();
    const raw = result?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("").trim() ?? "";
    let parsed: { reply?: string; handoff?: boolean; reason?: string };
    try { parsed = JSON.parse(raw); } catch { parsed = { handoff: true }; }
    const handoff = parsed.handoff !== false || typeof parsed.reply !== "string" || !parsed.reply.trim();
    const reply = handoff
      ? "وصلت رسالتك، وحولتها إلى فريق خدمة العملاء حتى يتابعها موظف مختص. راح نرجعلك بأقرب وقت."
      : parsed.reply!.trim().slice(0, 3000);

    const { data: inserted, error: insertError } = await admin.from("support_messages").insert({
      conversation_id: conversation.id,
      sender_id: conversation.user_id,
      body: reply,
      is_ai: true,
      ai_reply_to: message.id,
    }).select("id,body,created_at,is_ai").single();
    if (insertError) {
      if (insertError.code === "23505") return json({ ok: true, duplicate: true });
      console.error("support AI reply insert failed", insertError.message);
      return json({ error: "reply_save_failed" }, 500);
    }
    await admin.from("support_conversations").update({
      ai_status: handoff ? "waiting_human" : "ai_answered",
      ticket_status: handoff ? "in_progress" : "new",
    }).eq("id", conversation.id);
    return json({ ok: true, handoff, reply: inserted.body });
  } catch (error) {
    const message = error instanceof Error ? error.message : "internal_error";
    const missingSecret = message.startsWith("missing_");
    console.error("support-ai-reply error", message);
    return json({ error: missingSecret ? message : "internal_error" }, missingSecret ? 503 : 500);
  }
});
