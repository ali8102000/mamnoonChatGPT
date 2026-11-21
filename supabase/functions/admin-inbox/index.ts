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
    const { data: isSuperAdmin } = await caller.rpc("is_super_admin", { p_user_id: auth.user.id });
    if ((moderationError && isSuperAdmin !== true) || (moderation !== true && permission !== true && isSuperAdmin !== true)) return json({ error: "forbidden" }, 403);

    const admin = createClient(url, secret, {
      global: { fetch: createSupabaseFetch(secret) },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== "string") return json({ error: "invalid_request" }, 400);

    if (body.action === "list") {
      const limit = Number.isInteger(body.limit) ? Math.max(1, Math.min(100, body.limit)) : 50;
      const filter = ["all", "needs_reply", "unread", "bot", "human", "resolved", "customer", "technician", "driver", "restaurant", "hotel", "store"].includes(body.filter) ? body.filter : "all";
      const searchTerm = typeof body.search === "string" ? body.search.trim().slice(0, 100) : "";
      let matchedIds: string[] | null = null;
      if (searchTerm.length >= 2) {
        const safeSearch = searchTerm.replace(/[,%()]/g, " ");
        const { data: matches, error: searchError } = await admin.from("profiles")
          .select("id")
          .or(`full_name.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%`)
          .limit(200);
        if (searchError) return json({ error: "inbox_search_failed" }, 500);
        matchedIds = (matches ?? []).map((p: any) => p.id);
        if (!matchedIds.length) return json({ conversations: [] });
      }

      let supportQuery = admin.from("support_conversations")
        .select("id,user_id,subject,status,created_at,updated_at,priority_tier,ai_status,ticket_status,needs_admin_reply,handoff_status,assigned_staff_id,last_message_source,last_message_at")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (matchedIds) supportQuery = supportQuery.in("user_id", matchedIds);
      if (filter === "needs_reply") supportQuery = supportQuery.eq("needs_admin_reply", true);
      if (filter === "resolved") supportQuery = supportQuery.eq("handoff_status", "resolved");
      const [{ data: supportRows, error: supportError }, { data: chatRows, error: chatError }] = await Promise.all([
        supportQuery,
        admin.from("chats").select("id,request_id,customer_id,provider_id,updated_at").order("updated_at", { ascending: false }).limit(limit),
      ]);
      if (supportError || chatError) return json({ error: "inbox_load_failed" }, 500);

      const requestIds = [...new Set((chatRows ?? []).map((c: any) => c.request_id).filter(Boolean))];
      const [{ data: supportMessages }, { data: serviceMessages }, { data: requests }] = await Promise.all([
        (supportRows ?? []).length
          ? admin.from("support_messages").select("id,conversation_id,sender_id,body,created_at,is_ai,ai_reply_to,read_at").in("conversation_id", (supportRows ?? []).map((c: any) => c.id)).order("created_at", { ascending: false })
          : Promise.resolve({ data: [] }),
        (chatRows ?? []).length
          ? admin.from("messages").select("id,chat_id,sender_id,content,created_at").in("chat_id", (chatRows ?? []).map((c: any) => c.id)).order("created_at", { ascending: false })
          : Promise.resolve({ data: [] }),
        requestIds.length
          ? admin.from("service_requests").select("id,type,status,vehicle_category").in("id", requestIds)
          : Promise.resolve({ data: [] }),
      ]);

      const participantIds = [...new Set([
        ...(supportRows ?? []).map((c: any) => c.user_id),
        ...(chatRows ?? []).flatMap((c: any) => [c.customer_id, c.provider_id]).filter(Boolean),
      ])];
      const [{ data: profiles }, { data: roles }, { data: partners }] = await Promise.all([
        participantIds.length ? admin.from("profiles").select("id,full_name,phone,email,governorate_key,avatar_url").in("id", participantIds) : Promise.resolve({ data: [] }),
        participantIds.length ? admin.from("user_roles").select("user_id,role").in("user_id", participantIds) : Promise.resolve({ data: [] }),
        participantIds.length ? admin.from("partner_business_profiles").select("user_id,partner_type,business_vertical").in("user_id", participantIds) : Promise.resolve({ data: [] }),
      ]);
      const profileById = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      const rolesById = new Map<string, string[]>();
      for (const row of roles ?? []) rolesById.set(row.user_id, [...(rolesById.get(row.user_id) ?? []), String(row.role)]);
      const partnerById = new Map((partners ?? []).map((p: any) => [p.user_id, String(p.partner_type || p.business_vertical || "")]));
      const requestById = new Map((requests ?? []).map((request: any) => [request.id, request]));
      const categoryFor = (userId: string) => {
        const roleList = rolesById.get(userId) ?? [];
        if (roleList.some(x => ["driver", "large_driver"].includes(x))) return "driver";
        if (roleList.includes("worker")) return "technician";
        const partner = (partnerById.get(userId) ?? "").toLowerCase();
        if (partner.includes("restaurant") || partner.includes("food") || roleList.includes("restaurant")) return "restaurant";
        if (partner.includes("hotel") || partner.includes("hospitality") || roleList.includes("hotel")) return "hotel";
        if (partner.includes("store") || partner.includes("shop") || partner.includes("grocery") || roleList.includes("store")) return "store";
        return "customer";
      };
      const latestSupport = new Map<string, any>();
      for (const message of supportMessages ?? []) if (!latestSupport.has(message.conversation_id)) latestSupport.set(message.conversation_id, message);
      const latestService = new Map<string, any>();
      for (const message of serviceMessages ?? []) if (!latestService.has(message.chat_id)) latestService.set(message.chat_id, message);

      const mappedSupport = (supportRows ?? []).map((conversation: any) => ({
        ...conversation,
        conversation_type: "support",
        profile: profileById.get(conversation.user_id) ?? null,
        roles: rolesById.get(conversation.user_id) ?? [],
        account_category: categoryFor(conversation.user_id),
        latest_message: latestSupport.get(conversation.id) ?? null,
      }));
      const mappedService = (chatRows ?? []).map((chat: any) => {
        const request = requestById.get(chat.request_id);
        const latest = latestService.get(chat.id);
        return {
          id: chat.id,
          conversation_type: "service",
          user_id: chat.customer_id,
          request_id: chat.request_id,
          request_type: request?.type ?? "service",
          request_status: request?.status ?? null,
          vehicle_category: request?.vehicle_category ?? null,
          subject: request?.type === "taxi" ? "محادثة رحلة تكسي" : "محادثة طلب خدمة",
          status: request?.status ?? "open",
          created_at: chat.updated_at,
          updated_at: chat.updated_at,
          last_message_at: latest?.created_at ?? chat.updated_at,
          last_message_source: latest?.sender_id === chat.customer_id ? "customer" : latest?.sender_id === chat.provider_id ? "provider" : "admin",
          needs_admin_reply: false,
          handoff_status: "service_chat",
          ticket_status: "in_progress",
          assigned_staff_id: null,
          profile: profileById.get(chat.customer_id) ?? null,
          provider_profile: profileById.get(chat.provider_id) ?? null,
          roles: rolesById.get(chat.provider_id) ?? [],
          account_category: request?.type === "taxi" ? "driver" : categoryFor(chat.provider_id || chat.customer_id),
          customer_category: categoryFor(chat.customer_id),
          latest_message: latest ? { ...latest, body: latest.content, conversation_id: chat.id } : null,
        };
      }).filter((chat: any) => !matchedIds || matchedIds.includes(chat.user_id) || matchedIds.includes(chat.provider_profile?.id));

      let allConversations = [...mappedSupport, ...mappedService];
      const categoryFilters = ["customer", "technician", "driver", "restaurant", "hotel", "store"];
      if (categoryFilters.includes(filter)) {
        allConversations = allConversations.filter((c: any) => c.account_category === filter || c.customer_category === filter);
      } else if (filter === "unread") {
        allConversations = allConversations.filter((c: any) => c.conversation_type === "support" && c.latest_message && !c.latest_message.read_at && c.latest_message.sender_id === c.user_id);
      } else if (filter === "bot") {
        allConversations = allConversations.filter((c: any) => c.conversation_type === "support" && (c.last_message_source === "bot" || c.latest_message?.is_ai === true));
      } else if (filter === "human") {
        allConversations = allConversations.filter((c: any) => c.conversation_type === "support" && (["waiting_for_admin", "assigned"].includes(c.handoff_status) || c.last_message_source === "admin"));
      } else if (filter === "needs_reply") {
        allConversations = allConversations.filter((c: any) => c.conversation_type === "support" && c.needs_admin_reply);
      } else if (filter === "resolved") {
        allConversations = allConversations.filter((c: any) => c.conversation_type === "support" && c.handoff_status === "resolved");
      }
      allConversations.sort((a: any, b: any) => Date.parse(b.last_message_at || b.updated_at) - Date.parse(a.last_message_at || a.updated_at));
      return json({ conversations: allConversations.slice(0, limit) });
    }

    if (body.action === "messages") {
      if (!isUuid(body.conversation_id)) return json({ error: "invalid_conversation" }, 400);
      if (body.conversation_type === "service") {
        const { data: chat, error: chatError } = await admin.from("chats")
          .select("id,request_id,customer_id,provider_id").eq("id", body.conversation_id).maybeSingle();
        if (chatError || !chat) return json({ error: "conversation_not_found" }, 404);
        const { data: messages, error } = await admin.from("messages")
          .select("id,chat_id,sender_id,content,created_at")
          .eq("chat_id", body.conversation_id).order("created_at", { ascending: true }).limit(500);
        if (error) return json({ error: "messages_load_failed" }, 500);
        const senderIds = [...new Set((messages ?? []).map((m: any) => m.sender_id))];
        const { data: profiles } = senderIds.length
          ? await admin.from("profiles").select("id,full_name,phone").in("id", senderIds)
          : { data: [] };
        const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]));
        return json({ conversation: chat, messages: (messages ?? []).map((m: any) => ({ ...m, body: m.content, is_ai: false, sender: byId.get(m.sender_id) ?? null })) });
      }
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
      if (body.conversation_type === "service") {
        const { data: chat, error: chatError } = await admin.from("chats")
          .select("id").eq("id", body.conversation_id).maybeSingle();
        if (chatError || !chat) return json({ error: "conversation_not_found" }, 404);
        const { data: inserted, error: insertError } = await admin.from("messages").insert({
          chat_id: body.conversation_id,
          sender_id: auth.user.id,
          content: body.message.trim(),
        }).select("id,chat_id,sender_id,content,created_at").single();
        if (insertError || !inserted) return json({ error: "reply_send_failed" }, 500);
        await admin.from("chats").update({ updated_at: inserted.created_at }).eq("id", body.conversation_id);
        return json({ ok: true, message: { ...inserted, body: inserted.content, is_ai: false } });
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
