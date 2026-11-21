import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import { getSupabasePublishableKey, getSupabaseSecretKey, createSupabaseFetch } from "../_shared/api-keys.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const publishable = getSupabasePublishableKey();
    const secret = getSupabaseSecretKey();
    if (!url || !secret) return json({ error: "server_configuration_incomplete" }, 503);

    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) return json({ error: "unauthorized" }, 401);

    const caller = createClient(url, publishable, {
      global: { fetch: createSupabaseFetch(publishable), headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await caller.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "unauthorized" }, 401);

    const { data: moderation, error: moderationError } = await caller.rpc("has_chat_moderation_access", {
      p_user_id: auth.user.id,
    });
    const { data: permission } = await caller.rpc("admin_has_permission", {
      p_permission_key: "chats.moderate",
      p_scope_type: "global",
      p_scope_governorate: null,
    });
    if (moderationError || (moderation !== true && permission !== true)) return json({ error: "forbidden" }, 403);

    const admin = createClient(url, secret, {
      global: { fetch: createSupabaseFetch(secret) },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== "string") return json({ error: "invalid_request" }, 400);

    if (body.action === "list") {
      const limit = Number.isInteger(body.limit) ? Math.max(1, Math.min(100, body.limit)) : 50;
      const filter = ["all", "needs_reply", "unread", "bot", "human", "resolved", "customer", "technician", "driver", "restaurant", "hotel", "store"].includes(body.filter) ? body.filter : "all";
      let query = admin.from("support_conversations")
        .select("id,user_id,subject,status,created_at,updated_at,priority_tier,ai_status,ticket_status,needs_admin_reply,handoff_status,assigned_staff_id,last_message_source,last_message_at")
        .order("needs_admin_reply", { ascending: false })
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (filter === "needs_reply") query = query.eq("needs_admin_reply", true);
      if (filter === "resolved") query = query.eq("handoff_status", "resolved");
      const { data: conversations, error } = await query;
      if (error) return json({ error: "inbox_load_failed" }, 500);
      const ids = [...new Set((conversations ?? []).map((c: any) => c.user_id))];
      const [{ data: profiles }, { data: roles }, { data: partners }] = await Promise.all([
        ids.length ? admin.from("profiles").select("id,full_name,phone,email,governorate_key").in("id", ids) : Promise.resolve({ data: [] }),
        ids.length ? admin.from("user_roles").select("user_id,role").in("user_id", ids) : Promise.resolve({ data: [] }),
        ids.length ? admin.from("partner_business_profiles").select("user_id,partner_type,business_vertical").in("user_id", ids) : Promise.resolve({ data: [] }),
      ]);
      const conversationIds = (conversations ?? []).map((c: any) => c.id);
      const { data: messages } = conversationIds.length
        ? await admin.from("support_messages").select("id,conversation_id,sender_id,body,created_at,is_ai,ai_reply_to,read_at").in("conversation_id", conversationIds).order("created_at", { ascending: false })
        : { data: [] };
      const profileById = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      const rolesById = new Map<string, string[]>();
      for (const row of roles ?? []) rolesById.set(row.user_id, [...(rolesById.get(row.user_id) ?? []), String(row.role)]);
      const partnerById = new Map((partners ?? []).map((p: any) => [p.user_id, String(p.partner_type || p.business_vertical || "")]));
      const latestByConversation = new Map<string, any>();
      for (const message of messages ?? []) if (!latestByConversation.has(message.conversation_id)) latestByConversation.set(message.conversation_id, message);
      const mappedConversations = (conversations ?? []).map((c: any) => ({
        ...c,
        profile: profileById.get(c.user_id) ?? null,
        roles: rolesById.get(c.user_id) ?? [],
        account_category: (() => {
          const r = rolesById.get(c.user_id) ?? [];
          if (r.some(x => ["driver", "large_driver"].includes(x))) return "driver";
          if (r.includes("worker")) return "technician";
          const partner = (partnerById.get(c.user_id) ?? "").toLowerCase();
          if (partner.includes("restaurant") || partner.includes("food")) return "restaurant";
          if (partner.includes("hotel") || partner.includes("hospitality")) return "hotel";
          if (partner.includes("store") || partner.includes("shop") || partner.includes("grocery")) return "store";
          if (r.includes("restaurant")) return "restaurant";
          if (r.includes("hotel")) return "hotel";
          if (r.includes("store")) return "store";
          return "customer";
        })(),
        latest_message: latestByConversation.get(c.id) ?? null,
      }));
      const categoryFilters = ["customer", "technician", "driver", "restaurant", "hotel", "store"];
      let filteredConversations = mappedConversations;
      if (categoryFilters.includes(filter)) {
        filteredConversations = filteredConversations.filter((c: any) => c.account_category === filter);
      } else if (filter === "unread") {
        filteredConversations = filteredConversations.filter((c: any) =>
          c.latest_message && !c.latest_message.read_at && c.latest_message.sender_id === c.user_id
        );
      } else if (filter === "bot") {
        filteredConversations = filteredConversations.filter((c: any) =>
          c.last_message_source === "bot" || c.latest_message?.is_ai === true
        );
      } else if (filter === "human") {
        filteredConversations = filteredConversations.filter((c: any) =>
          ["waiting_for_admin","assigned"].includes(c.handoff_status) || c.last_message_source === "admin"
        );
      }
      return json({ conversations: filteredConversations });
    }

    if (body.action === "messages") {
      if (!isUuid(body.conversation_id)) return json({ error: "invalid_conversation" }, 400);
      const { data: conversation, error: conversationError } = await admin.from("support_conversations")
        .select("id,user_id,subject,needs_admin_reply,handoff_status,assigned_staff_id")
        .eq("id", body.conversation_id).maybeSingle();
      if (conversationError || !conversation) return json({ error: "conversation_not_found" }, 404);
      // Mark incoming messages read through the caller JWT before loading them,
      // so the returned thread reflects the updated read receipts.
      await caller.from("support_messages").update({ read_at: new Date().toISOString() })
        .eq("conversation_id", body.conversation_id).neq("sender_id", auth.user.id).is("read_at", null);
      await admin.from("support_conversations").update({ ticket_status: "in_progress" })
        .eq("id", body.conversation_id).eq("ticket_status", "new");
      const { data: messages, error } = await admin.from("support_messages")
        .select("id,conversation_id,sender_id,body,created_at,is_ai,ai_reply_to,read_at,read_by")
        .eq("conversation_id", body.conversation_id).order("created_at", { ascending: true }).limit(500);
      if (error) return json({ error: "messages_load_failed" }, 500);
      const senderIds = [...new Set((messages ?? []).map((m: any) => m.sender_id))];
      const { data: profiles } = senderIds.length
        ? await admin.from("profiles").select("id,full_name,phone").in("id", senderIds)
        : { data: [] };
      const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      return json({ conversation, messages: (messages ?? []).map((m: any) => ({ ...m, sender: byId.get(m.sender_id) ?? null })) });
    }

    if (body.action === "reply") {
      if (!isUuid(body.conversation_id) || typeof body.message !== "string" || !body.message.trim() || body.message.length > 4000) {
        return json({ error: "invalid_reply" }, 400);
      }
      const { data: conversation, error: conversationError } = await admin.from("support_conversations")
        .select("id,user_id").eq("id", body.conversation_id).maybeSingle();
      if (conversationError || !conversation) return json({ error: "conversation_not_found" }, 404);
      const { data: inserted, error: insertError } = await admin.from("support_messages").insert({
        conversation_id: body.conversation_id,
        sender_id: auth.user.id,
        body: body.message.trim(),
        is_ai: false,
      }).select("id,conversation_id,sender_id,body,created_at,is_ai").single();
      if (insertError || !inserted) return json({ error: "reply_send_failed" }, 500);
      const { error: updateError } = await admin.from("support_conversations").update({
        needs_admin_reply: false,
        handoff_status: "assigned",
        last_message_source: "admin",
        last_message_at: inserted.created_at,
        ticket_status: "in_progress",
        ai_status: "waiting_human",
        assigned_staff_id: auth.user.id,
        updated_at: inserted.created_at,
      }).eq("id", body.conversation_id);
      if (updateError) return json({ error: "conversation_update_failed" }, 500);
      return json({ ok: true, message: inserted });
    }

    if (body.action === "handoff") {
      if (!isUuid(body.conversation_id)) return json({ error: "invalid_conversation" }, 400);
      const { error } = await admin.from("support_conversations").update({
        needs_admin_reply: true,
        handoff_status: "waiting_for_admin",
        ai_status: "waiting_human",
        last_message_source: "bot",
        updated_at: new Date().toISOString(),
      }).eq("id", body.conversation_id);
      if (error) return json({ error: "handoff_failed" }, 500);
      return json({ ok: true });
    }

    if (body.action === "resolve") {
      if (!isUuid(body.conversation_id)) return json({ error: "invalid_conversation" }, 400);
      const { error } = await admin.from("support_conversations").update({
        needs_admin_reply: false,
        handoff_status: "resolved",
        ticket_status: "resolved",
        ai_status: "active",
        updated_at: new Date().toISOString(),
      }).eq("id", body.conversation_id);
      if (error) return json({ error: "resolve_failed" }, 500);
      return json({ ok: true });
    }

    return json({ error: "unknown_action" }, 400);
  } catch {
    return json({ error: "internal_error" }, 500);
  }
});
