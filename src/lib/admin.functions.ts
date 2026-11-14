import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireStaff(context: any) {
  const { supabase, userId } = context;
  const { data } = await (supabase as any).rpc("has_staff_role", { p_user_id: userId });
  if (!data) throw new Error("غير مصرّح: للمشرفين فقط");
}

async function requireAdmin(context: any) {
  const { supabase, userId } = context;
  const { data } = await (supabase as any).rpc("has_admin_access", { p_user_id: userId });
  if (!data) throw new Error("غير مصرّح: للمديرين فقط");
}

async function requireSuperAdmin(context: any) {
  const { supabase, userId } = context;
  const { data } = await (supabase as any).rpc("is_super_admin", { p_user_id: userId });
  if (!data) throw new Error("غير مصرّح: للمدير الأعلى فقط");
}

export const checkSuperAdminExists = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await (supabaseAdmin as any)
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "super_admin");
    return { exists: (count ?? 0) > 0 };
  });

export const bootstrapSuperAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ secret: z.string().min(32).max(256) }).parse(d))
  .handler(async ({ data, context }) => {
    const expectedEmail = process.env.MAMNOON_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    const expectedSecret = process.env.MAMNOON_BOOTSTRAP_SECRET;

    if (!expectedEmail || !expectedSecret || expectedSecret.length < 32) {
      throw new Error("إعداد التهيئة الآمنة غير مكتمل على الخادم");
    }
    if (String(context.claims.email ?? "").toLowerCase() !== expectedEmail) {
      throw new Error("هذا الحساب غير مخوّل لإعداد المدير الأعلى");
    }
    if (data.secret !== expectedSecret) {
      throw new Error("رمز التهيئة غير صحيح");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await (supabaseAdmin as any).rpc(
      "bootstrap_first_super_admin",
      { p_user_id: context.userId },
    );
    if (error) throw new Error("فشل إنشاء المدير الأعلى: " + error.message);
    if (!created) throw new Error("يوجد مدير أعلى بالفعل");
    return { ok: true };
  });

export const adminGrantRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ target_user_id: z.string().uuid(), role: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context);
    const { supabase } = context;
    const { error } = await (supabase as any).rpc("admin_grant_role", {
      p_target_user: data.target_user_id,
      p_role: data.role,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminRevokeRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ target_user_id: z.string().uuid(), role: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context);
    const { supabase } = context;
    const { error } = await (supabase as any).rpc("admin_revoke_role", {
      p_target_user: data.target_user_id,
      p_role: data.role,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getStaffRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ user_id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabase } = context;
    const targetId = data?.user_id ?? context.userId;
    const { data: roles, error } = await (supabase as any).rpc("get_staff_roles", {
      p_user_id: targetId,
    });
    if (error) throw new Error(error.message);
    return roles ?? [];
  });

export const adminSearchUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        query: z.string().min(1).max(100),
        limit: z.number().int().min(1).max(100).default(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: users, error } = await (supabaseAdmin as any)
      .from("profiles")
      .select("id, phone, full_name, email, created_at, avatar_url")
      .or(`phone.ilike.%${data.query}%,full_name.ilike.%${data.query}%,email.ilike.%${data.query}%`)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error("فشل البحث");
    return users ?? [];
  });

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const offset = (data.page - 1) * data.limit;
    const [usersRes, blocksRes] = await Promise.all([
      (supabaseAdmin as any)
        .from("profiles")
        .select("id, phone, full_name, email, created_at, avatar_url", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + data.limit - 1),
      (supabaseAdmin as any).from("user_blocks").select("user_id, reason, expires_at, blocked_at"),
    ]);
    if (usersRes.error) throw new Error("فشل تحميل المستخدمين");
    const blockedMap = new Map<string, any>();
    for (const b of blocksRes.data ?? []) blockedMap.set(b.user_id, b);
    return {
      users: (usersRes.data ?? []).map((u: any) => ({
        ...u,
        blocked: blockedMap.get(u.id) ?? null,
      })),
      total: usersRes.count ?? 0,
    };
  });

export const adminBlockUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        user_id: z.string().min(1),
        reason: z.string().max(500).optional(),
        expires_at: z.string().optional().nullable(),
        duration: z
          .enum(["1_hour", "1_day", "1_week", "1_month", "permanent"])
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabase } = context;
    let computedExpiresAt = data.expires_at ?? null;
    if (data.duration) {
      const now = Date.now();
      if (data.duration === "1_hour") computedExpiresAt = new Date(now + 3600 * 1000).toISOString();
      else if (data.duration === "1_day") computedExpiresAt = new Date(now + 86400 * 1000).toISOString();
      else if (data.duration === "1_week") computedExpiresAt = new Date(now + 7 * 86400 * 1000).toISOString();
      else if (data.duration === "1_month") computedExpiresAt = new Date(now + 30 * 86400 * 1000).toISOString();
      else if (data.duration === "permanent") computedExpiresAt = null;
    }
    const { error } = await (supabase as any).rpc("admin_block_user", {
      p_user_id: data.user_id,
      p_reason: data.reason ?? null,
      p_expires_at: computedExpiresAt,
    });
    if (error) throw new Error(error.message);
    return { ok: true, expires_at: computedExpiresAt };
  });

export const adminUnblockUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ user_id: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabase } = context;
    const { error } = await (supabase as any).rpc("admin_unblock_user", {
      p_user_id: data.user_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminGetUserDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ user_id: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [profileRes, rolesRes, blocksRes, driverRes, workerRes, txRes, reqRes, ratingsRes] =
      await Promise.all([
        (supabaseAdmin as any).from("profiles").select("*").eq("id", data.user_id).maybeSingle(),
        (supabaseAdmin as any)
          .from("user_roles")
          .select("role, created_at")
          .eq("user_id", data.user_id),
        (supabaseAdmin as any)
          .from("user_blocks")
          .select("*")
          .eq("user_id", data.user_id)
          .maybeSingle(),
        (supabaseAdmin as any)
          .from("driver_profiles")
          .select("*")
          .eq("user_id", data.user_id)
          .maybeSingle(),
        (supabaseAdmin as any)
          .from("worker_profiles")
          .select("*")
          .eq("user_id", data.user_id)
          .maybeSingle(),
        (supabaseAdmin as any)
          .from("transactions")
          .select("*")
          .eq("user_id", data.user_id)
          .order("created_at", { ascending: false })
          .limit(20),
        (supabaseAdmin as any)
          .from("service_requests")
          .select("id, type, status, created_at, price_estimate")
          .or(`customer_id.eq.${data.user_id},provider_id.eq.${data.user_id}`)
          .order("created_at", { ascending: false })
          .limit(20),
        (supabaseAdmin as any)
          .from("ratings")
          .select("id, stars, professionalism, punctuality, quality, comment, created_at, rater:profiles!ratings_rater_id_fkey(full_name, avatar_url)")
          .eq("ratee_id", data.user_id)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
    return {
      profile: profileRes.data,
      roles: rolesRes.data ?? [],
      block: blocksRes.data,
      driverProfile: driverRes.data,
      workerProfile: workerRes.data,
      transactions: txRes.data ?? [],
      requests: reqRes.data ?? [],
      ratings: ratingsRes.error ? [] : ratingsRes.data ?? [],
    };
  });

export const adminUpdateProviderName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ user_id: z.string().uuid(), full_name: z.string().trim().min(2).max(80) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: provider, error: providerError } = await (supabaseAdmin as any)
      .from("driver_profiles").select("user_id").eq("user_id", data.user_id).maybeSingle();
    const { data: worker, error: workerError } = await (supabaseAdmin as any)
      .from("worker_profiles").select("user_id").eq("user_id", data.user_id).maybeSingle();
    if (providerError || workerError) throw new Error("تعذر التحقق من حساب مقدم الخدمة");
    if (!provider && !worker) throw new Error("تعديل الاسم متاح للسائقين والفنيين فقط");
    const { error } = await (supabaseAdmin as any)
      .from("profiles").update({ full_name: data.full_name }).eq("id", data.user_id);
    if (error) throw new Error("فشل تحديث الاسم: " + error.message);
    return { ok: true, full_name: data.full_name };
  });

export const adminListProviders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      type: z.enum(["driver", "large_driver", "worker"]).default("driver"),
      status: z.enum(["all", "approved", "pending", "suspended", "rejected"]).default("all"),
      category: z.string().default("all"),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const table = data.type === "worker" ? "worker_profiles" : "driver_profiles";
    let providerQuery = (supabaseAdmin as any)
      .from(table)
      .select("*, profiles!inner(full_name, phone, email, avatar_url)");
    if (data.status !== "all") providerQuery = providerQuery.eq("status", data.status);
    if (data.type !== "worker" && data.category !== "all") providerQuery = providerQuery.eq("vehicle_category", data.category);
    if (data.type === "worker" && data.category !== "all") providerQuery = providerQuery.eq("level", data.category);
    const { data: providers, error } = await providerQuery
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(`فشل تحميل المزودين: ${error.message}`);

    const userIds = (providers ?? []).map((p: any) => p.user_id);
    if (!userIds.length) return [];
    const { data: verifications, error: verificationError } = await (supabaseAdmin as any)
      .from("provider_verifications")
      .select("*")
      .eq("provider_type", data.type)
      .in("user_id", userIds);
    if (verificationError) throw new Error(`تعذر تحميل مستمسكات المزودين: ${verificationError.message}`);

    const verificationByUser = new Map((verifications ?? []).map((v: any) => [v.user_id, v]));
    return await Promise.all((providers ?? []).map(async (provider: any) => {
      const verification: any = verificationByUser.get(provider.user_id);
      if (!verification) return { ...provider, verification: null };
      const [face, identity, identityBack, vehicleDocument] = await Promise.all([
        supabaseAdmin.storage.from("provider-verification").createSignedUrl(verification.face_photo_path, 600),
        supabaseAdmin.storage.from("provider-verification").createSignedUrl(verification.id_card_photo_path, 600),
        verification.id_card_back_photo_path
          ? supabaseAdmin.storage.from("provider-verification").createSignedUrl(verification.id_card_back_photo_path, 600)
          : Promise.resolve({ data: null, error: null }),
        verification.vehicle_document_path
          ? supabaseAdmin.storage.from("provider-verification").createSignedUrl(verification.vehicle_document_path, 600)
          : Promise.resolve({ data: null, error: null }),
      ]);
      return {
        ...provider,
        verification: {
          ...verification,
          face_photo_url: face.error ? null : face.data?.signedUrl ?? null,
          id_card_photo_url: identity.error ? null : identity.data?.signedUrl ?? null,
          id_card_back_photo_url: identityBack.error ? null : identityBack.data?.signedUrl ?? null,
          vehicle_document_url: vehicleDocument.error ? null : vehicleDocument.data?.signedUrl ?? null,
        },
      };
    }));
  });

export const adminSetProviderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        user_id: z.string().min(1),
        type: z.enum(["driver", "large_driver", "worker"]),
        status: z.enum(["approved", "suspended", "rejected", "pending"]),
        reason: z.string().max(500).optional(),
        suspension_duration: z.enum(["30m", "1h", "1w", "1mo", "1y", "permanent"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabase } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const durationMinutes: Record<string, number> = { "30m": 30, "1h": 60, "1w": 10080, "1mo": 43200, "1y": 525600 };
    const suspendedUntil = data.status === "suspended" && data.suspension_duration && data.suspension_duration !== "permanent"
      ? new Date(Date.now() + durationMinutes[data.suspension_duration] * 60_000).toISOString()
      : null;
    if (data.status === "rejected" && !data.reason?.trim()) {
      throw new Error("اكتب سبب الرفض حتى يصل للمستخدم بشكل واضح");
    }

    const { error } = await (supabase as any).rpc("admin_set_provider_status", {
      p_user_id: data.user_id,
      p_type: data.type,
      p_status: data.status,
      p_suspended_until: suspendedUntil,
    });
    if (error) throw new Error(error.message);

    if (data.status === "approved" || data.status === "rejected") {
      const { error: verificationUpdateError } = await (supabaseAdmin as any)
        .from("provider_verifications")
        .update({
          status: data.status,
          rejection_reason: data.status === "rejected" ? data.reason!.trim() : null,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", data.user_id)
        .eq("provider_type", data.type);
      if (verificationUpdateError) {
        throw new Error(`تم تحديث حالة الحساب لكن تعذر تحديث سجل المستمسكات: ${verificationUpdateError.message}`);
      }
    }

    const role = data.type === "driver" ? "driver" : data.type === "large_driver" ? "large_driver" : "worker";
    if (data.status === "approved") {
      const { data: granted, error: verifyError } = await (supabaseAdmin as any)
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user_id)
        .eq("role", role)
        .maybeSingle();
      if (verifyError) throw new Error(`تعذر التحقق من الدور بعد الموافقة: ${verifyError.message}`);
      if (!granted) throw new Error("لم يُضف دور مقدم الخدمة إلى الحساب؛ لم يتم تأكيد التفعيل");
    }

    let notificationSent = false;
    let pushSent = 0;
    if (data.status === "approved" || data.status === "rejected" || data.status === "suspended") {
      const { data: profileRow } = await (supabaseAdmin as any)
        .from("profiles").select("full_name").eq("id", data.user_id).maybeSingle();
      const personName = String(profileRow?.full_name ?? "").trim();
      const providerLabel = data.type === "driver" ? "سائق تكسي" : data.type === "large_driver" ? "سائق سيارات كبيرة" : "فني";
      const { data: companySettings } = await (supabaseAdmin as any)
        .from("company_settings").select("company_name").eq("id", 1).maybeSingle();
      const companyName = String(companySettings?.company_name ?? "شركة ممنون");
      const durationLabels: Record<string, string> = {
        "30m": "نصف ساعة", "1h": "ساعة", "1w": "أسبوع", "1mo": "شهر", "1y": "سنة", permanent: "بشكل دائم",
      };
      const title = data.status === "approved"
        ? "تهانينا! تم تفعيل حسابك في ممنون 🎉"
        : data.status === "rejected"
          ? "بخصوص طلب انضمامك إلى ممنون"
          : "تنبيه: تم تعليق حسابك في ممنون";
      const body = data.status === "approved"
        ? `أهلاً ${personName || "بك"}، نبارك لك! تم تفعيل حسابك كـ${providerLabel} بعد مراجعة الإدارة. نتمنى لك التوفيق والنجاح، ونرحب بك ضمن أسرة ${companyName} الموثّقة. 💛`
        : data.status === "rejected"
          ? `أهلاً ${personName || "بك"}، نعتذر عن عدم قبول طلبك حالياً. سبب الرفض: ${data.reason!.trim()}. يرجى معالجة الملاحظة وإعادة المحاولة، ونتمنى لك التوفيق. ${companyName} الموثّقة.`
          : `أهلاً ${personName || "بك"}، نود إعلامك بأنه تم تعليق حسابك كـ${providerLabel} ${data.suspension_duration === "permanent" ? "بشكل دائم" : `لمدة ${durationLabels[data.suspension_duration ?? ""] ?? "محددة"}`}${suspendedUntil ? `، وينتهي التعليق بتاريخ ${new Date(suspendedUntil).toLocaleString("ar-IQ")}` : ""}.${data.reason?.trim() ? ` السبب: ${data.reason.trim()}.` : ""} للاستفسار يرجى مراسلة إدارة ${companyName}.`;
      const notificationType = data.status === "approved" ? "provider_approved" : data.status === "rejected" ? "provider_rejected" : "provider_suspended";
      const { error: notificationError } = await (supabaseAdmin as any).from("notifications").insert({
        user_id: data.user_id, type: notificationType, title, body, link: "/home",
        data: { provider_type: data.type, status: data.status, suspended_until: suspendedUntil, company: companyName },
      });
      if (notificationError) throw new Error(`تم تحديث حالة الحساب لكن تعذر إرسال الإشعار داخل التطبيق: ${notificationError.message}`);
      notificationSent = true;

      const { data: pushRows } = await (supabaseAdmin as any)
        .from("user_push_tokens").select("expo_push_token").eq("user_id", data.user_id);
      const tokens = (pushRows ?? []).map((row: any) => row.expo_push_token)
        .filter((token: string) => typeof token === "string" && token.startsWith("ExponentPushToken["));
      for (let i = 0; i < tokens.length; i += 100) {
        const messages = tokens.slice(i, i + 100).map((to: string) => ({
          to, sound: "default", title, body,
          data: { type: "provider_verification", provider_type: data.type, status: data.status },
          channelId: "default",
        }));
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
          console.warn("[provider-notification] Expo push delivery failed", pushError);
        }
      }
    }
    return { ok: true, role: data.status === "approved" ? role : null, notification_sent: notificationSent, push_sent: pushSent };
  });

export const adminListRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        status: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let query = (supabaseAdmin as any)
      .from("service_requests")
      .select(
        "id, type, status, price_estimate, created_at, pickup_text, dest_text, customer_id, provider_id",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status && data.status !== "all") query = query.eq("status", data.status);
    const { data: requests, error } = await query;
    if (error) throw new Error("فشل تحميل الطلبات");
    return requests ?? [];
  });

export const adminCancelRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ request_id: z.string().uuid(), reason: z.string().max(500).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabase } = context;
    const { error } = await (supabase as any).rpc("admin_cancel_request", {
      p_request_id: data.request_id,
      p_reason: data.reason ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminReopenRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ request_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabase } = context;
    const { error } = await (supabase as any).rpc("admin_reopen_request", {
      p_request_id: data.request_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminAdjustWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        user_id: z.string().uuid(),
        amount: z.number(),
        note: z.string().max(500).optional(),
        type: z.enum(["credit", "debit"]).default("credit"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabase } = context;
    const { error } = await (supabase as any).rpc("admin_adjust_wallet", {
      p_user_id: data.user_id,
      p_amount: data.amount,
      p_note: data.note ?? null,
      p_type: data.type,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ limit: z.number().int().min(1).max(200).default(100) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: txs, error } = await (supabaseAdmin as any)
      .from("transactions")
      .select("*, profiles!inner(full_name, phone)")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error("فشل تحميل المعاملات");
    return txs ?? [];
  });

export const adminListCoupons = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: coupons, error } = await (supabaseAdmin as any)
      .from("coupons")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error("فشل تحميل الكوبونات");
    return coupons ?? [];
  });

export const adminSaveCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        code: z.string().min(2).max(50),
        type: z.enum(["percentage", "fixed"]).default("percentage"),
        value: z.number().min(0),
        max_uses: z.number().int().min(1).default(1000),
        expires_at: z.string().datetime().optional().nullable(),
        active: z.boolean().default(true),
        min_amount: z.number().min(0).default(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabase } = context;
    const { error } = await (supabase as any).rpc("admin_save_coupon", {
      p_id: data.id ?? null,
      p_code: data.code,
      p_type: data.type,
      p_value: data.value,
      p_max_uses: data.max_uses,
      p_expires_at: data.expires_at ?? null,
      p_active: data.active,
      p_min_amount: data.min_amount,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ coupon_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabase } = context;
    const { error } = await (supabase as any).rpc("admin_delete_coupon", {
      p_coupon_id: data.coupon_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        status: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let query = (supabaseAdmin as any)
      .from("user_reports")
      .select(
        "*, reporter:profiles!user_reports_reporter_id_fkey(full_name, phone), reported:profiles!user_reports_reported_id_fkey(full_name, phone)",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status && data.status !== "all") query = query.eq("status", data.status);
    const { data: reports, error } = await query;
    if (error) throw new Error("فشل تحميل البلاغات");
    return reports ?? [];
  });

export const adminResolveReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        report_id: z.string().uuid(),
        status: z.enum(["resolved", "closed", "dismissed"]),
        note: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabase } = context;
    const { error } = await (supabase as any).rpc("admin_resolve_report", {
      p_report_id: data.report_id,
      p_status: data.status,
      p_note: data.note ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListFriends = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ limit: z.number().int().min(1).max(200).default(100) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: friends, error } = await (supabaseAdmin as any)
      .from("friends")
      .select(
        "*, user:profiles!friends_user_id_fkey(full_name, phone), friend:profiles!friends_friend_id_fkey(full_name, phone)",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error("فشل تحميل الأصدقاء");
    return friends ?? [];
  });

export const adminListFriendRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ limit: z.number().int().min(1).max(200).default(100) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: reqs, error } = await (supabaseAdmin as any)
      .from("friend_requests")
      .select(
        "*, sender:profiles!friend_requests_sender_id_fkey(full_name, phone), receiver:profiles!friend_requests_receiver_id_fkey(full_name, phone)",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error("فشل تحميل طلبات الصداقة");
    return reqs ?? [];
  });

export const adminDeleteFriendship = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ user1_id: z.string().uuid(), user2_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabase } = context;
    const { error } = await (supabase as any).rpc("admin_delete_friendship", {
      p_user1_id: data.user1_id,
      p_user2_id: data.user2_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteFriendRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ request_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabase } = context;
    const { error } = await (supabase as any).rpc("admin_delete_friend_request", {
      p_request_id: data.request_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        chat_id: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(200).default(100),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let query = (supabaseAdmin as any)
      .from("messages")
      .select("*, sender:profiles!messages_sender_id_fkey(full_name, phone), chat:chats(id)")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.chat_id) query = query.eq("chat_id", data.chat_id);
    const { data: messages, error } = await query;
    if (error) throw new Error("فشل تحميل الرسائل");
    return messages ?? [];
  });

export const adminDeleteMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ message_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabase } = context;
    const { error } = await (supabase as any).rpc("admin_delete_message", {
      p_message_id: data.message_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListChats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ limit: z.number().int().min(1).max(200).default(100) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: chats, error } = await (supabaseAdmin as any)
      .from("chats")
      .select(
        "*, participant1:profiles!chats_customer_id_fkey(full_name, phone), participant2:profiles!chats_provider_id_fkey(full_name, phone)",
      )
      .order("updated_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error("فشل تحميل المحادثات");
    return chats ?? [];
  });

export const adminBroadcastNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        target: z.enum(["all", "drivers", "workers", "single"]),
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(2000),
        user_id: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabase } = context;
    const { data: count, error } = await (supabase as any).rpc("admin_broadcast_notification", {
      p_target: data.target,
      p_title: data.title,
      p_body: data.body,
      p_single_user_id: data.user_id ?? null,
    });
    if (error) throw new Error(error.message);
    return { sent: count ?? 0 };
  });

export const adminListAuditLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ limit: z.number().int().min(1).max(200).default(100) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: logs, error } = await (supabaseAdmin as any)
      .from("audit_logs")
      .select("*, admin:profiles!audit_logs_user_id_fkey(full_name, phone)")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error("فشل تحميل السجل");
    return logs ?? [];
  });

export const adminGetDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [
      usersRes,
      driversRes,
      workersRes,
      activeDriversRes,
      activeWorkersRes,
      reqAllRes,
      reqActiveRes,
      reqDoneRes,
      reqCancelledRes,
      todayTxRes,
      monthTxRes,
      yearTxRes,
    ] = await Promise.all([
      (supabaseAdmin as any).from("profiles").select("id", { count: "exact", head: true }),
      (supabaseAdmin as any).from("driver_profiles").select("id", { count: "exact", head: true }),
      (supabaseAdmin as any).from("worker_profiles").select("id", { count: "exact", head: true }),
      (supabaseAdmin as any)
        .from("driver_profiles")
        .select("id", { count: "exact", head: true })
        .eq("available", true),
      (supabaseAdmin as any)
        .from("worker_profiles")
        .select("id", { count: "exact", head: true })
        .eq("available", true),
      (supabaseAdmin as any).from("service_requests").select("id", { count: "exact", head: true }),
      (supabaseAdmin as any)
        .from("service_requests")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "searching", "accepted", "in_progress"]),
      (supabaseAdmin as any)
        .from("service_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "completed"),
      (supabaseAdmin as any)
        .from("service_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "cancelled"),
      (supabaseAdmin as any)
        .from("transactions")
        .select("amount, type")
        .gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
      (supabaseAdmin as any)
        .from("transactions")
        .select("amount, type")
        .gte(
          "created_at",
          new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
        ),
      (supabaseAdmin as any)
        .from("transactions")
        .select("amount, type")
        .gte("created_at", new Date(new Date().getFullYear(), 0, 1).toISOString()),
    ]);
    function sumCredit(rows: any[]) {
      return (rows ?? [])
        .filter((r) => r.type === "commission")
        .reduce((s, r) => s + Math.abs(Number(r.amount)), 0);
    }
    return {
      totalUsers: usersRes.count ?? 0,
      totalDrivers: driversRes.count ?? 0,
      totalWorkers: workersRes.count ?? 0,
      activeDrivers: activeDriversRes.count ?? 0,
      activeWorkers: activeWorkersRes.count ?? 0,
      totalRequests: reqAllRes.count ?? 0,
      activeRequests: reqActiveRes.count ?? 0,
      completedRequests: reqDoneRes.count ?? 0,
      cancelledRequests: reqCancelledRes.count ?? 0,
      dailyRevenue: sumCredit(todayTxRes.data),
      monthlyRevenue: sumCredit(monthTxRes.data),
      yearlyRevenue: sumCredit(yearTxRes.data),
    };
  });

export const adminGetLiveLocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: locations, error } = await (supabaseAdmin as any)
      .from("live_locations")
      .select("*, profile:profiles!live_locations_user_id_fkey(full_name, phone)")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) throw new Error("فشل تحميل المواقع");
    return locations ?? [];
  });

export const adminGetLiveRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: requests, error } = await (supabaseAdmin as any)
      .from("service_requests")
      .select(
        "id, type, status, pickup_lat, pickup_lng, dest_lat, dest_lng, pickup_text, dest_text, created_at",
      )
      .in("status", ["pending", "searching", "accepted", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error("فشل تحميل الطلبات");
    return requests ?? [];
  });

export const adminGetMonitoringData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [users, drivers, workers, activeReq, pendingRep, blk, tck] = await Promise.all([
      (supabaseAdmin as any).from("profiles").select("id", { count: "exact", head: true }),
      (supabaseAdmin as any)
        .from("driver_profiles")
        .select("id", { count: "exact", head: true })
        .eq("available", true),
      (supabaseAdmin as any)
        .from("worker_profiles")
        .select("id", { count: "exact", head: true })
        .eq("available", true),
      (supabaseAdmin as any)
        .from("service_requests")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "searching", "accepted", "in_progress"]),
      (supabaseAdmin as any)
        .from("user_reports")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20),
      (supabaseAdmin as any)
        .from("user_blocks")
        .select("*, profiles!user_blocks_user_id_fkey(full_name)")
        .order("blocked_at", { ascending: false })
        .limit(20),
      (supabaseAdmin as any)
        .from("support_tickets")
        .select("*")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    return {
      stats: {
        totalUsers: users.count ?? 0,
        activeDrivers: drivers.count ?? 0,
        activeWorkers: workers.count ?? 0,
        activeRequests: activeReq.count ?? 0,
      },
      reports: (pendingRep.data ?? []) as any[],
      blocks: (blk.data ?? []) as any[],
      tickets: (tck.data ?? []) as any[],
    };
  });
