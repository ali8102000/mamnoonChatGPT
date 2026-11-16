import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });
const required = (key: string) => {
  const value = Deno.env.get(key);
  if (!value) throw new Error("missing_" + key);
  return value;
};
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function notificationChannelId(soundEnabled: boolean, vibrationEnabled: boolean) {
  if (soundEnabled && vibrationEnabled) return "mamnoon_sound_vibrate";
  if (soundEnabled) return "mamnoon_sound_only";
  if (vibrationEnabled) return "mamnoon_vibrate_only";
  return "mamnoon_silent";
}

function searchTerms(raw: string) {
  const term = raw.trim().replace(/[,%()]/g, " ").slice(0, 100);
  const digits = term.replace(/[٠-٩۰-۹]/g, d => {
    const n = d.charCodeAt(0);
    return String(n >= 0x06f0 ? n - 0x06f0 : n - 0x0660);
  }).replace(/\D/g, "");
  const phones = new Set<string>();
  if (digits) {
    phones.add(digits);
    if (digits.startsWith("00")) phones.add(digits.slice(2));
    if (digits.startsWith("964")) {
      phones.add("+" + digits);
      phones.add("0" + digits.slice(3));
      phones.add(digits.slice(3));
    } else if (digits.startsWith("0")) {
      phones.add("964" + digits.slice(1));
      phones.add("+964" + digits.slice(1));
    } else if (digits.startsWith("7")) {
      phones.add("0" + digits);
      phones.add("964" + digits);
      phones.add("+964" + digits);
    }
  }
  return { term, digits, phones: [...phones] };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const url = required("SUPABASE_URL");
    const anon = required("SUPABASE_ANON_KEY");
    const service = required("SUPABASE_SERVICE_ROLE_KEY");
    const header = req.headers.get("Authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return json({ error: "unauthorized" }, 401);
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await caller.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "unauthorized" }, 401);
    const { data: staff, error: staffError } = await caller.rpc("has_staff_role", { p_user_id: auth.user.id });
    if (staffError || staff !== true) return json({ error: "forbidden" }, 403);
    const { data: staffRolesData, error: staffRolesError } = await caller.rpc("get_staff_roles", {
      p_user_id: auth.user.id,
    });
    if (staffRolesError || !Array.isArray(staffRolesData)) return json({ error: "forbidden" }, 403);
    const staffRoles = new Set(staffRolesData.map((entry: unknown) =>
      typeof entry === "string" ? entry : String((entry as { role?: unknown } | null)?.role ?? ""),
    ));
    // Mirror the web admin's department/rank access model. These derived roles
    // are used only where the web panel grants read access; mutation handlers
    // continue to require their existing admin/super-admin checks.
    const { data: assignment } = await caller.from("staff_assignments")
      .select("rank,department").eq("user_id", auth.user.id).eq("active", true).maybeSingle();
    if (assignment?.rank) staffRoles.add(`rank:${assignment.rank}`);
    if (assignment?.department) staffRoles.add(`department_${assignment.department}`);
    const requireRoles = (allowed: string[]) => {
      if (!allowed.some((role) => staffRoles.has(role))) throw new Error("role_required");
    };
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== "string") return json({ error: "invalid_request" }, 400);
    const requireAdmin = async () => {
      const { data, error } = await caller.rpc("has_admin_access", { p_user_id: auth.user.id });
      if (error || data !== true) throw new Error("admin_required");
    };

    if (body.action === "governorate_stats") {
      requireRoles(["super_admin", "admin"]);
      const { data, error } = await admin.rpc("admin_governorate_user_stats");
      if (error) return json({ error: "governorate_stats_failed" }, 500);
      return json({ rows: data ?? [] });
    }

    if (body.action === "update_profile") {
      await requireAdmin();
      if (!isUuid(body.user_id) ||
          typeof body.full_name !== "string" ||
          body.full_name.trim().length < 2 ||
          body.full_name.trim().length > 100) {
        return json({ error: "invalid_profile_update" }, 400);
      }
      const allowedGovernorates = ["baghdad","basra","nineveh","erbil","sulaymaniyah","duhok","kirkuk","najaf","karbala","babil","anbar","diyala","saladin","wasit","dhiqar","maysan","muthanna","qadisiyah"];
      const governorateKey = body.governorate_key === null || body.governorate_key === "" ? null : body.governorate_key;
      if (governorateKey !== null && (typeof governorateKey !== "string" || !allowedGovernorates.includes(governorateKey))) {
        return json({ error: "invalid_governorate" }, 400);
      }
      const updates: Record<string, unknown> = {
        full_name: body.full_name.trim(),
        governorate_key: governorateKey,
        updated_at: new Date().toISOString(),
      };
      if (body.avatar_base64 !== undefined) {
        if (typeof body.avatar_base64 !== "string" || body.avatar_base64.length > 7000000 ||
            !["image/jpeg","image/png","image/webp"].includes(body.avatar_mime)) {
          return json({ error: "invalid_avatar" }, 400);
        }
        const extension = body.avatar_mime === "image/png" ? "png" : body.avatar_mime === "image/webp" ? "webp" : "jpg";
        const binary = atob(body.avatar_base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const path = `${body.user_id}/admin-${Date.now()}.${extension}`;
        const { error: uploadError } = await admin.storage.from("avatars").upload(path, bytes, {
          contentType: body.avatar_mime, cacheControl: "3600", upsert: false,
        });
        if (uploadError) return json({ error: "avatar_upload_failed" }, 500);
        const { data: publicUrl } = admin.storage.from("avatars").getPublicUrl(path);
        updates.avatar_url = publicUrl.publicUrl;
      }
      const { data: profile, error } = await admin.from("profiles").update(updates)
        .eq("id", body.user_id)
        .select("id,full_name,avatar_url,governorate_key")
        .single();
      if (error) return json({ error: "profile_update_failed" }, 500);
      return json({ profile });
    }

    if (body.action === "list" || body.action === "search") {
      requireRoles(["super_admin", "admin", "support", "moderator", "department_monitoring", "rank:general_manager"]);
      const isSearch = body.action === "search";
      if (isSearch && (typeof body.query !== "string" || body.query.trim().length < 2)) {
        return json({ error: "query_too_short" }, 400);
      }
      const page = Number.isInteger(body.page) ? Math.max(1, Math.min(100000, body.page)) : 1;
      const limit = Number.isInteger(body.limit) ? Math.max(1, Math.min(50, body.limit)) : 50;
      let query = admin.from("profiles")
        .select("id,phone,full_name,email,created_at,avatar_url", { count: "exact" })
        .order("created_at", { ascending: false });
      if (isSearch) {
        const { term, digits, phones } = searchTerms(body.query);
        const filters = [
          `full_name.ilike.%${term}%`,
          `email.ilike.%${term}%`,
          ...phones.map(p => `phone.ilike.%${p}%`),
          ...(digits ? [`email.ilike.%phone${digits}%`] : []),
        ];
        query = query.or(filters.join(",")).limit(100);
      } else {
        query = query.range((page - 1) * limit, page * limit - 1);
      }
      const { data: users, count, error } = await query;
      if (error) return json({ error: "users_load_failed" }, 500);
      const ids = (users ?? []).map((u: any) => u.id);
      if (!ids.length) return json({ users: [], total: count ?? 0 });
      const { data: blocks, error: blocksError } = await admin.from("user_blocks")
        .select("user_id,reason,expires_at,blocked_at").in("user_id", ids);
      if (blocksError) return json({ error: "user_blocks_load_failed" }, 500);
      const blockMap = new Map((blocks ?? []).map((b: any) => [b.user_id, b]));
      return json({
        users: (users ?? []).map((u: any) => ({ ...u, blocked: blockMap.get(u.id) ?? null })),
        total: count ?? 0,
      });
    }

    if (body.action === "detail") {
      requireRoles(["super_admin", "admin", "support", "moderator", "department_monitoring", "rank:general_manager"]);
      if (!isUuid(body.user_id)) return json({ error: "invalid_user_id" }, 400);
      const id = body.user_id;
      const [profile, roles, block, driver, worker, transactions, requests, ratings] = await Promise.all([
        admin.from("profiles").select("*").eq("id", id).maybeSingle(),
        admin.from("user_roles").select("role,created_at").eq("user_id", id),
        admin.from("user_blocks").select("*").eq("user_id", id).maybeSingle(),
        admin.from("driver_profiles").select("*").eq("user_id", id).maybeSingle(),
        admin.from("worker_profiles").select("*").eq("user_id", id).maybeSingle(),
        admin.from("transactions").select("*").eq("user_id", id).order("created_at", { ascending: false }).limit(20),
        admin.from("service_requests").select("id,type,status,created_at,price_estimate")
          .or(`customer_id.eq.${id},provider_id.eq.${id}`).order("created_at", { ascending: false }).limit(20),
        admin.from("ratings").select("id,stars,professionalism,punctuality,quality,comment,created_at,rater:profiles!ratings_rater_id_fkey(full_name,avatar_url)")
          .eq("ratee_id", id).order("created_at", { ascending: false }).limit(100),
        admin.from("provider_verifications").select("provider_type,legal_name,phone,email,document_type,id_number,status,rejection_reason,metadata,face_photo_path,id_card_photo_path,id_card_back_photo_path,vehicle_document_path,submitted_at,reviewed_at,updated_at")
          .eq("user_id", id),
      ]);
      const failed = [profile, roles, block, driver, worker, transactions, requests, verifications].find((r: any) => r.error);
      if (failed?.error) return json({ error: "user_detail_load_failed" }, 500);
      const signedVerifications = await Promise.all((verifications.data ?? []).map(async (row: any) => {
        const sign = async (path: string | null) => {
          if (!path) return null;
          const { data, error } = await admin.storage.from("provider-verification").createSignedUrl(path, 600);
          return error ? null : data?.signedUrl ?? null;
        };
        const [face, front, back, vehicle] = await Promise.all([
          sign(row.face_photo_path), sign(row.id_card_photo_path),
          sign(row.id_card_back_photo_path), sign(row.vehicle_document_path),
        ]);
        return {
          provider_type: row.provider_type, legal_name: row.legal_name, phone: row.phone, email: row.email,
          document_type: row.document_type, id_number: row.id_number, status: row.status,
          rejection_reason: row.rejection_reason, metadata: row.metadata,
          face_photo_url: face, id_card_photo_url: front, id_card_back_photo_url: back,
          vehicle_document_url: vehicle, submitted_at: row.submitted_at,
          reviewed_at: row.reviewed_at, updated_at: row.updated_at,
        };
      }));
      return json({
        profile: profile.data, roles: roles.data ?? [], block: block.data,
        driverProfile: driver.data, workerProfile: worker.data,
        transactions: transactions.data ?? [], requests: requests.data ?? [],
        verifications: signedVerifications,
        ratings: ratings.error ? [] : ratings.data ?? [],
        ratings_error: !!ratings.error,
      });
    }

    if (body.action === "providers") {
      requireRoles(["super_admin", "admin", "support", "department_operations", "rank:general_manager"]);
      const type = ["driver", "large_driver", "worker"].includes(body.type) ? body.type : "driver";
      const status = ["all", "approved", "pending", "suspended", "rejected"].includes(body.status) ? body.status : "all";
      const category = typeof body.category === "string" ? body.category.slice(0, 80) : "all";
      const table = type === "worker" ? "worker_profiles" : "driver_profiles";
      let providerQuery = admin.from(table)
        .select("*, profiles!inner(full_name,phone,email,avatar_url)", { count: "exact" });
      if (status !== "all") providerQuery = providerQuery.eq("status", status);
      if (category !== "all") providerQuery = providerQuery.eq(type === "worker" ? "level" : "vehicle_category", category);
      const { data: providers, count, error } = await providerQuery
        .order("created_at", { ascending: false }).limit(200);
      if (error) return json({ error: "providers_load_failed" }, 500);
      const userIds = (providers ?? []).map((provider: any) => provider.user_id).filter(isUuid);
      if (!userIds.length) return json({ providers: [], total: count ?? 0 });
      const { data: verifications, error: verificationError } = await admin.from("provider_verifications")
        .select("*").eq("provider_type", type).in("user_id", userIds);
      if (verificationError) return json({ error: "provider_verifications_load_failed" }, 500);
      const verificationByUser = new Map((verifications ?? []).map((row: any) => [row.user_id, row]));
      const enriched = await Promise.all((providers ?? []).map(async (provider: any) => {
        const verification: any = verificationByUser.get(provider.user_id);
        if (!verification) return { ...provider, verification: null };
        const sign = async (path: string | null | undefined) => {
          if (!path) return null;
          const { data, error } = await admin.storage.from("provider-verification").createSignedUrl(path, 600);
          return error ? null : data?.signedUrl ?? null;
        };
        const [face, front, back, vehicle] = await Promise.all([
          sign(verification.face_photo_path), sign(verification.id_card_photo_path),
          sign(verification.id_card_back_photo_path), sign(verification.vehicle_document_path),
        ]);
        return { ...provider, verification: {
          status: verification.status, rejection_reason: verification.rejection_reason,
          face_photo_url: face, id_card_photo_url: front,
          id_card_back_photo_url: back, vehicle_document_url: vehicle,
        } };
      }));
      return json({ providers: enriched, total: count ?? enriched.length });
    }

    if (body.action === "requests") {
      requireRoles(["super_admin", "admin", "support", "department_operations", "rank:general_manager"]);
      const status = typeof body.status === "string" ? body.status.slice(0, 40) : "all";
      const limit = Number.isInteger(body.limit) ? Math.max(1, Math.min(200, body.limit)) : 100;
      let requestQuery = admin.from("service_requests")
        .select("id,type,status,price_estimate,created_at,pickup_text,dest_text,customer_id,provider_id")
        .order("created_at", { ascending: false }).limit(limit);
      if (status !== "all") requestQuery = requestQuery.eq("status", status);
      const { data: requests, error } = await requestQuery;
      if (error) return json({ error: "requests_load_failed" }, 500);
      return json({ requests: requests ?? [] });
    }

    if (body.action === "set_provider_status") {
      await requireAdmin();
      const types = ["driver", "large_driver", "worker"];
      const statuses = ["approved", "suspended", "rejected", "pending"];
      const durations = ["30m", "1h", "1w", "1mo", "1y", "permanent"];
      if (!isUuid(body.user_id) || !types.includes(body.type) || !statuses.includes(body.status) ||
          (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 500)) ||
          (body.status === "suspended" && !durations.includes(body.suspension_duration))) {
        return json({ error: "invalid_provider_status_request" }, 400);
      }
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (body.status === "rejected" && !reason) {
        return json({ error: "rejection_reason_required" }, 400);
      }
      const durationMinutes: Record<string, number> = {
        "30m": 30, "1h": 60, "1w": 10080, "1mo": 43200, "1y": 525600,
      };
      const suspendedUntil = body.status === "suspended" && body.suspension_duration !== "permanent"
        ? new Date(Date.now() + durationMinutes[body.suspension_duration] * 60000).toISOString()
        : null;
      const { error: statusError } = await caller.rpc("admin_set_provider_status", {
        p_user_id: body.user_id,
        p_type: body.type,
        p_status: body.status,
        p_suspended_until: suspendedUntil,
      });
      if (statusError) return json({ error: statusError.message }, 400);

      if (body.status === "approved" || body.status === "rejected") {
        const { error } = await admin.from("provider_verifications").update({
          status: body.status,
          rejection_reason: body.status === "rejected" ? reason : null,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("user_id", body.user_id).eq("provider_type", body.type);
        if (error) return json({ error: "provider_verification_update_failed" }, 500);
      }

      const role = body.type === "driver" ? "driver" : body.type === "large_driver" ? "large_driver" : "worker";
      if (body.status === "approved") {
        const { data: granted, error } = await admin.from("user_roles")
          .select("role").eq("user_id", body.user_id).eq("role", role).maybeSingle();
        if (error || !granted) return json({ error: "provider_role_activation_not_confirmed" }, 409);
      }

      let notificationSent = false;
      let pushSent = 0;
      if (["approved", "rejected", "suspended"].includes(body.status)) {
        const { data: profile } = await admin.from("profiles").select("full_name").eq("id", body.user_id).maybeSingle();
        const personName = String(profile?.full_name ?? "").trim();
        const providerLabel = body.type === "driver" ? "سائق تكسي" : body.type === "large_driver" ? "سائق سيارات كبيرة" : "فني";
        const { data: settings } = await admin.from("company_settings").select("company_name").eq("id", 1).maybeSingle();
        const companyName = String(settings?.company_name ?? "شركة ممنون");
        const durationLabels: Record<string, string> = {
          "30m": "نصف ساعة", "1h": "ساعة", "1w": "أسبوع", "1mo": "شهر", "1y": "سنة", permanent: "بشكل دائم",
        };
        const title = body.status === "approved"
          ? "تهانينا! تم تفعيل حسابك في ممنون 🎉"
          : body.status === "rejected" ? "بخصوص طلب انضمامك إلى ممنون" : "تنبيه: تم تعليق حسابك في ممنون";
        const messageBody = body.status === "approved"
          ? `أهلاً ${personName || "بك"}، نبارك لك! تم تفعيل حسابك كـ${providerLabel} بعد مراجعة الإدارة. نتمنى لك التوفيق والنجاح، ونرحب بك ضمن أسرة ${companyName} الموثّقة. 💛`
          : body.status === "rejected"
            ? `أهلاً ${personName || "بك"}، نعتذر عن عدم قبول طلبك حالياً. سبب الرفض: ${reason}. يرجى معالجة الملاحظة وإعادة المحاولة، ونتمنى لك التوفيق. ${companyName} الموثّقة.`
            : `أهلاً ${personName || "بك"}، نود إعلامك بأنه تم تعليق حسابك كـ${providerLabel} ${body.suspension_duration === "permanent" ? "بشكل دائم" : `لمدة ${durationLabels[body.suspension_duration] ?? "محددة"}`}${suspendedUntil ? `, وينتهي التعليق بتاريخ ${new Date(suspendedUntil).toLocaleString("ar-IQ")}` : ""}.${reason ? ` السبب: ${reason}.` : ""} للاستفسار يرجى مراسلة إدارة ${companyName}.`;
        const notificationType = body.status === "approved" ? "provider_approved" : body.status === "rejected" ? "provider_rejected" : "provider_suspended";
        const { error: notificationError } = await admin.from("notifications").insert({
          user_id: body.user_id, type: notificationType, title, body: messageBody, link: "/home",
          data: { provider_type: body.type, status: body.status, suspended_until: suspendedUntil, company: companyName },
        });
        if (notificationError) return json({ error: "provider_notification_save_failed" }, 500);
        notificationSent = true;

        const { data: pushRows, error: pushRowsError } = await admin.from("user_push_tokens")
          .select("expo_push_token,sound_enabled,vibration_enabled").eq("user_id", body.user_id);
        if (pushRowsError) return json({ error: "provider_push_preferences_load_failed" }, 500);
        const tokens = (pushRows ?? []).filter((row: any) =>
          typeof row.expo_push_token === "string" &&
          (row.expo_push_token.startsWith("ExpoPushToken[") || row.expo_push_token.startsWith("ExponentPushToken[")),
        );
        for (let i = 0; i < tokens.length; i += 100) {
          const messages = tokens.slice(i, i + 100).map((row: any) => {
            const soundEnabled = row.sound_enabled !== false;
            const vibrationEnabled = row.vibration_enabled !== false;
            return {
              to: row.expo_push_token,
              sound: soundEnabled ? "default" : null,
              title,
              body: messageBody,
              data: { type: "provider_verification", provider_type: body.type, status: body.status },
              channelId: notificationChannelId(soundEnabled, vibrationEnabled),
            };
          });
          try {
            const response = await fetch("https://exp.host/--/api/v2/push/send", {
              method: "POST",
              headers: { Accept: "application/json", "Content-Type": "application/json" },
              body: JSON.stringify(messages),
            });
            if (response.ok) {
              const payload = await response.json() as { data?: Array<{ status?: string }> };
              pushSent += (payload.data ?? []).filter((ticket) => ticket.status === "ok").length;
            }
          } catch (pushError) {
            console.warn("[admin-users] provider push delivery failed", pushError);
          }
        }
      }
      return json({ ok: true, role: body.status === "approved" ? role : null, notification_sent: notificationSent, push_sent: pushSent });
    }

    if (body.action === "cancel_request") {
      await requireAdmin();
      if (!isUuid(body.request_id) || typeof body.reason !== "string" || body.reason.length > 500) {
        return json({ error: "invalid_request" }, 400);
      }
      const { error } = await caller.rpc("admin_cancel_request", {
        p_request_id: body.request_id, p_reason: body.reason.trim() || null,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === "reopen_request") {
      await requireAdmin();
      if (!isUuid(body.request_id)) return json({ error: "invalid_request_id" }, 400);
      const { error } = await caller.rpc("admin_reopen_request", { p_request_id: body.request_id });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === "block") {
      await requireAdmin();
      if (!isUuid(body.user_id) || typeof body.reason !== "string" || body.reason.length > 500 ||
          !["1_hour", "1_day", "1_week", "1_month", "permanent"].includes(body.duration)) {
        return json({ error: "invalid_request" }, 400);
      }
      const minutes: Record<string, number> = { "1_hour": 60, "1_day": 1440, "1_week": 10080, "1_month": 43200 };
      const expiry = body.duration === "permanent" ? null : new Date(Date.now() + minutes[body.duration] * 60000).toISOString();
      const { error } = await caller.rpc("admin_block_user", {
        p_user_id: body.user_id, p_reason: body.reason.trim() || null, p_expires_at: expiry,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, expires_at: expiry });
    }

    if (body.action === "unblock") {
      await requireAdmin();
      if (!isUuid(body.user_id)) return json({ error: "invalid_user_id" }, 400);
      const { error } = await caller.rpc("admin_unblock_user", { p_user_id: body.user_id });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === "live_map") {
      requireRoles(["super_admin", "admin", "support", "department_operations", "department_monitoring", "rank:general_manager"]);
      const [locations, requests] = await Promise.all([
        admin.from("live_locations")
          .select("*, profile:profiles!live_locations_user_id_fkey(full_name,phone)")
          .order("updated_at", { ascending: false }).limit(500),
        admin.from("service_requests")
          .select("id,type,status,pickup_lat,pickup_lng,dest_lat,dest_lng,pickup_text,dest_text,created_at")
          .in("status", ["pending", "searching", "accepted", "in_progress"])
          .order("created_at", { ascending: false }).limit(200),
      ]);
      if (locations.error || requests.error) return json({ error: "live_map_load_failed" }, 500);
      return json({ locations: locations.data ?? [], requests: requests.data ?? [] });
    }

    if (body.action === "reports") {
      requireRoles(["super_admin", "admin", "support", "moderator", "department_monitoring", "rank:general_manager"]);
      const { data: reports, error } = await admin.from("user_reports")
        .select("*, reporter:profiles!user_reports_reporter_id_fkey(full_name,phone), reported:profiles!user_reports_reported_id_fkey(full_name,phone)")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return json({ error: "reports_load_failed" }, 500);
      return json({ reports: reports ?? [] });
    }

    if (body.action === "monitoring") {
      requireRoles(["super_admin", "admin", "support", "rank:general_manager"]);
      const [users, drivers, workers, activeRequests, reports, blocks, tickets] = await Promise.all([
        admin.from("profiles").select("id", { count: "exact", head: true }),
        admin.from("driver_profiles").select("id", { count: "exact", head: true }).eq("available", true),
        admin.from("worker_profiles").select("id", { count: "exact", head: true }).eq("available", true),
        admin.from("service_requests").select("id", { count: "exact", head: true })
          .in("status", ["pending", "searching", "accepted", "in_progress"]),
        admin.from("user_reports").select("*").eq("status", "pending")
          .order("created_at", { ascending: false }).limit(20),
        admin.from("user_blocks").select("*, profiles!user_blocks_user_id_fkey(full_name)")
          .order("blocked_at", { ascending: false }).limit(20),
        admin.from("support_tickets").select("*").eq("status", "open")
          .order("created_at", { ascending: false }).limit(20),
      ]);
      if (users.error || drivers.error || workers.error || activeRequests.error ||
          reports.error || blocks.error || tickets.error) {
        return json({ error: "monitoring_load_failed" }, 500);
      }
      return json({
        stats: {
          totalUsers: users.count ?? 0,
          activeDrivers: drivers.count ?? 0,
          activeWorkers: workers.count ?? 0,
          activeRequests: activeRequests.count ?? 0,
        },
        reports: reports.data ?? [],
        blocks: blocks.data ?? [],
        tickets: tickets.data ?? [],
      });
    }

    if (body.action === "resolve_report") {
      if (!isUuid(body.report_id) || !["resolved", "closed", "dismissed"].includes(body.status)) {
        return json({ error: "invalid_report_resolution" }, 400);
      }
      if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 500)) {
        return json({ error: "invalid_report_note" }, 400);
      }
      const { error } = await caller.rpc("admin_resolve_report", {
        p_report_id: body.report_id,
        p_status: body.status,
        p_note: typeof body.note === "string" ? body.note.trim() || null : null,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === "chats") {
      requireRoles(["super_admin", "admin", "support", "moderator", "rank:general_manager"]);
      const limit = Number.isInteger(body.limit) ? Math.max(1, Math.min(200, body.limit)) : 100;
      const { data: chats, error } = await admin.from("chats")
        .select("*, participant1:profiles!chats_customer_id_fkey(full_name,phone), participant2:profiles!chats_provider_id_fkey(full_name,phone)")
        .order("updated_at", { ascending: false }).limit(limit);
      if (error) return json({ error: "chats_load_failed" }, 500);
      return json({ chats: chats ?? [] });
    }

    if (body.action === "messages") {
      requireRoles(["super_admin", "admin", "support", "moderator", "rank:general_manager"]);
      const limit = Number.isInteger(body.limit) ? Math.max(1, Math.min(200, body.limit)) : 100;
      let query = admin.from("messages")
        .select("*, sender:profiles!messages_sender_id_fkey(full_name,phone), chat:chats(id)")
        .order("created_at", { ascending: false }).limit(limit);
      if (typeof body.chat_id === "string" && isUuid(body.chat_id)) query = query.eq("chat_id", body.chat_id);
      const { data: messages, error } = await query;
      if (error) return json({ error: "messages_load_failed" }, 500);
      return json({ messages: messages ?? [] });
    }

    if (body.action === "delete_message") {
      requireRoles(["super_admin", "admin", "support", "moderator", "rank:general_manager"]);
      if (!isUuid(body.message_id)) return json({ error: "invalid_message_id" }, 400);
      const { error } = await caller.rpc("admin_delete_message", { p_message_id: body.message_id });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === "friends" || body.action === "friend_requests") {
      requireRoles(["super_admin", "admin", "moderator", "department_monitoring", "rank:general_manager"]);
      const limit = Number.isInteger(body.limit) ? Math.max(1, Math.min(200, body.limit)) : 100;
      if (body.action === "friends") {
        const { data, error } = await admin.from("friends")
          .select("*, user:profiles!friends_user_id_fkey(full_name,phone), friend:profiles!friends_friend_id_fkey(full_name,phone)")
          .order("created_at", { ascending: false }).limit(limit);
        if (error) return json({ error: "friends_load_failed" }, 500);
        return json({ friends: data ?? [] });
      }
      const { data, error } = await admin.from("friend_requests")
        .select("*, sender:profiles!friend_requests_sender_id_fkey(full_name,phone), receiver:profiles!friend_requests_receiver_id_fkey(full_name,phone)")
        .order("created_at", { ascending: false }).limit(limit);
      if (error) return json({ error: "friend_requests_load_failed" }, 500);
      return json({ requests: data ?? [] });
    }

    if (body.action === "delete_friendship") {
      requireRoles(["super_admin", "admin", "moderator", "rank:general_manager"]);
      if (!isUuid(body.user1_id) || !isUuid(body.user2_id) || body.user1_id === body.user2_id) {
        return json({ error: "invalid_friendship" }, 400);
      }
      const { error } = await caller.rpc("admin_delete_friendship", {
        p_user1_id: body.user1_id,
        p_user2_id: body.user2_id,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === "delete_friend_request") {
      requireRoles(["super_admin", "admin", "moderator", "rank:general_manager"]);
      if (!isUuid(body.request_id)) return json({ error: "invalid_request_id" }, 400);
      const { error } = await caller.rpc("admin_delete_friend_request", {
        p_request_id: body.request_id,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === "broadcast_notification") {
      requireRoles(["super_admin", "admin", "support", "finance", "moderator", "rank:general_manager"]);
      const targets = ["all", "drivers", "workers", "single"];
      if (!targets.includes(body.target) || typeof body.title !== "string" ||
          body.title.trim().length < 1 || body.title.length > 200 ||
          typeof body.body !== "string" || body.body.trim().length < 1 ||
          body.body.length > 2000 ||
          (body.target === "single" ? !isUuid(body.user_id) :
            (body.user_id !== undefined && !isUuid(body.user_id)))) {
        return json({ error: "invalid_notification" }, 400);
      }
      const { data, error } = await caller.rpc("admin_broadcast_notification", {
        p_target: body.target,
        p_title: body.title.trim(),
        p_body: body.body.trim(),
        p_single_user_id: body.user_id ?? null,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ sent: Number(data ?? 0) });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    const message = String(error);
    if (message.includes("missing_")) return json({ error: "server_configuration_incomplete" }, 503);
    if (message.includes("admin_required")) return json({ error: "admin_required" }, 403);
    if (message.includes("role_required")) return json({ error: "forbidden" }, 403);
    return json({ error: "internal_error" }, 500);
  }
});
