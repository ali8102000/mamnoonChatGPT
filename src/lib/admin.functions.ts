import { createClientFn } from "@/lib/client-server-fn";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

async function assertSuperAdmin() {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("سجّل الدخول أولاً");
  const { data, error } = await (supabase as any).rpc("is_super_admin", { p_user_id: auth.user.id });
  if (error || data !== true) throw new Error("غير مصرّح: للمدير الأعلى فقط");
  return auth.user.id;
}

const governorateKeySchema = z.enum([
  "baghdad", "basra", "nineveh", "erbil", "sulaymaniyah", "duhok", "kirkuk",
  "najaf", "karbala", "babil", "anbar", "diyala", "saladin", "wasit",
  "dhiqar", "maysan", "muthanna", "qadisiyah",
]);




export const checkSuperAdminExists = createClientFn({ method: "GET" })
  .handler(async ({ context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("bootstrap-admin", {
      body: { action: "check" },
    });
    if (error || result?.error) throw new Error("تعذر التحقق من حالة المدير الأعلى");
    return { exists: result?.exists === true };
  });


export const bootstrapSuperAdmin = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({ secret: z.string().min(32).max(256) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("bootstrap-admin", {
      body: { action: "bootstrap", secret: data.secret },
    });
    if (error || result?.error) throw new Error("فشل إنشاء المدير الأعلى");
    if (!result?.ok) throw new Error("يوجد مدير أعلى بالفعل");
    return { ok: true };
  });


export const adminGrantRole = async ({ data }: { data: { target_user_id: string; role: string } }) => {
  const input = z.object({ target_user_id: z.string().uuid(), role: z.string().min(1).max(80) }).parse(data);
  await assertSuperAdmin();
  const { error } = await (supabase as any).rpc("admin_grant_role", {
    p_target_user: input.target_user_id, p_role: input.role,
  });
  if (error) throw new Error(error.message);
  return { ok: true };
};


export const adminRevokeRole = async ({ data }: { data: { target_user_id: string; role: string } }) => {
  const input = z.object({ target_user_id: z.string().uuid(), role: z.string().min(1).max(80) }).parse(data);
  await assertSuperAdmin();
  const { error } = await (supabase as any).rpc("admin_revoke_role", {
    p_target_user: input.target_user_id, p_role: input.role,
  });
  if (error) throw new Error(error.message);
  return { ok: true };
};


export const adminListDepartmentStaff = createClientFn({ method: "GET" })
  .inputValidator((d) => z.object({}).parse(d))
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await (supabase as any).rpc("staff_list_department");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminPromoteStaffOneLevel = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({ target_user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rank, error } = await (supabase as any).rpc("staff_promote_one_level", {
      p_target_user: data.target_user_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true, rank };
  });


export const adminDeactivateStaff = async ({ data }: { data: { target_user_id: string } }) => {
  const input = z.object({ target_user_id: z.string().uuid() }).parse(data);
  await assertSuperAdmin();
  const { error } = await (supabase as any).rpc("staff_deactivate", { p_target_user: input.target_user_id });
  if (error) throw new Error(error.message);
  return { ok: true };
};


export const adminSetStaffRank = async ({ data }: { data: {
  target_user_id: string;
  rank: "owner" | "general_manager" | "department_manager" | "supervisor" | "employee";
  department: "executive" | "customer_service" | "finance" | "operations" | "monitoring";
  display_title?: string;
} }) => {
  const input = z.object({
    target_user_id: z.string().uuid(),
    rank: z.enum(["owner", "general_manager", "department_manager", "supervisor", "employee"]),
    department: z.enum(["executive", "customer_service", "finance", "operations", "monitoring"]),
    display_title: z.string().max(100).optional(),
  }).parse(data);
  await assertSuperAdmin();
  const { error } = await (supabase as any).rpc("staff_set_rank", {
    p_target_user: input.target_user_id,
    p_new_rank: input.rank,
    p_department: input.department,
    p_display_title: input.display_title ?? null,
  });
  if (error) throw new Error(error.message);
  return { ok: true };
};


export const getStaffRoles = async ({ data }: { data?: { user_id?: string } }) => {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("سجّل الدخول أولاً");
  const targetId = data?.user_id ?? auth.user.id;
  if (targetId === auth.user.id) {
    const { data: roles, error } = await (supabase as any).rpc("get_staff_roles", { p_user_id: auth.user.id });
    const allowed = ["super_admin", "admin", "support", "finance", "moderator"];
    if (error || !(roles ?? []).some((role: string) => allowed.includes(role))) {
      throw new Error("غير مصرّح: هذه الصلاحية غير متاحة لهذا القسم الوظيفي");
    }
    return roles ?? [];
  }
  await assertSuperAdmin();
  const { data: roles, error } = await (supabase as any).rpc("get_staff_roles", { p_user_id: targetId });
  if (error) throw new Error(error.message);
  return roles ?? [];
};


export const adminSearchUsers = createClientFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({
      query: z.string().min(1).max(100),
      limit: z.number().int().min(1).max(100).default(50),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "search", query: data.query, limit: data.limit },
    });
    if (error || result?.error) throw new Error("فشل البحث");
    return result?.users ?? [];
  });


export const adminListUsers = createClientFn({ method: "GET" })
  .inputValidator((d) =>
    z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "list", page: data.page, limit: data.limit },
    });
    if (error || result?.error) throw new Error("فشل تحميل المستخدمين");
    return { users: result?.users ?? [], total: result?.total ?? 0 };
  });


export const adminBlockUser = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({
    user_id: z.string().uuid(),
    reason: z.string().max(500).optional(),
    expires_at: z.string().optional().nullable(),
    duration: z.enum(["1_hour", "1_day", "1_week", "1_month", "permanent"]).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "block", ...data },
    });
    if (error || result?.error) throw new Error("فشل حظر المستخدم");
    return result;
  });


export const adminUnblockUser = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "unblock", ...data },
    });
    if (error || result?.error) throw new Error("فشل إلغاء حظر المستخدم");
    return { ok: true };
  });


export const adminGetUserDetail = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({ user_id: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "detail", user_id: data.user_id },
    });
    if (error || result?.error) throw new Error("فشل تحميل تفاصيل المستخدم");
    return result;
  });


export const adminUpdateProviderName = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({
    user_id: z.string().uuid(),
    full_name: z.string().trim().min(2).max(80),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "update_provider_name", ...data },
    });
    if (error || result?.error) throw new Error("فشل تحديث اسم مقدم الخدمة");
    return result;
  });


export const adminListProviders = createClientFn({ method: "GET" })
  .inputValidator((d) =>
    z.object({
      type: z.enum(["driver", "large_driver", "worker"]).default("driver"),
      status: z.enum(["all", "approved", "pending", "suspended", "rejected"]).default("all"),
      category: z.string().default("all"),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "providers", ...data },
    });
    if (error || result?.error) throw new Error("فشل تحميل المزودين");
    return result?.providers ?? [];
  });


export const adminListProviderChangeRequests = createClientFn({ method: "GET" })
  .handler(async ({ context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "provider_change_requests" },
    });
    if (error || result?.error) throw new Error("تعذر تحميل طلبات تحديث الاختصاصات");
    return result?.requests ?? [];
  });


export const adminReviewProviderChangeRequest = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({
    request_id: z.string().uuid(),
    status: z.enum(["approved", "rejected"]),
    reason: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "review_provider_change_request", ...data },
    });
    if (error || result?.error) throw new Error("فشل مراجعة طلب تحديث الاختصاصات");
    return { ok: true };
  });


export const adminSetProviderStatus = createClientFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({
      user_id: z.string().min(1),
      type: z.enum(["driver", "large_driver", "worker"]),
      status: z.enum(["approved", "suspended", "rejected", "pending"]),
      reason: z.string().max(500).optional(),
      suspension_duration: z.enum(["30m", "1h", "1w", "1mo", "1y", "permanent"]).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "set_provider_status", ...data },
    });
    if (error || result?.error) throw new Error("تعذر تحديث حالة مقدم الخدمة");
    return result;
  });


export const adminListRequests = createClientFn({ method: "GET" })
  .inputValidator((d) =>
    z.object({
      status: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "requests", ...data },
    });
    if (error || result?.error) throw new Error("فشل تحميل الطلبات");
    return result?.requests ?? [];
  });


export const adminCancelRequest = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({
    request_id: z.string().uuid(), reason: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "cancel_request", ...data },
    });
    if (error || result?.error) throw new Error("فشل إلغاء الطلب");
    return { ok: true };
  });


export const adminReopenRequest = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({ request_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "reopen_request", ...data },
    });
    if (error || result?.error) throw new Error("فشل إعادة فتح الطلب");
    return { ok: true };
  });


export const adminAdjustWallet = createClientFn({ method: "POST" })
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

export const adminListTransactions = createClientFn({ method: "GET" })
  .inputValidator((d) =>
    z.object({ limit: z.number().int().min(1).max(200).default(100) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-finance", {
      body: { action: "list_transactions", limit: data.limit },
    });
    if (error || result?.error) throw new Error("فشل تحميل المعاملات");
    return result?.transactions ?? [];
  });


export const adminListCoupons = createClientFn({ method: "GET" })
  .handler(async ({ context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-finance", {
      body: { action: "list_coupons" },
    });
    if (error || result?.error) throw new Error("فشل تحميل الكوبونات");
    return result?.coupons ?? [];
  });


export const adminSaveCoupon = createClientFn({ method: "POST" })
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

export const adminCouponAudienceCount = createClientFn({ method: "GET" })
  .inputValidator((d) => z.object({
    target: z.enum(["customers", "single", "customers_1", "customers_2", "customers_3", "customers_4", "customers_5"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: count, error } = await (supabase as any).rpc("admin_coupon_audience_count", {
      p_target: data.target,
    });
    if (error) throw new Error(error.message);
    return { count: Number(count ?? 0) };
  });

export const adminDistributeCoupon = createClientFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({
      coupon_id: z.string().uuid(),
      target: z.enum(["customers", "single", "customers_1", "customers_2", "customers_3", "customers_4", "customers_5"]),
      single_user_id: z.string().uuid().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: sent, error } = await (supabase as any).rpc("admin_distribute_coupon", {
      p_coupon_id: data.coupon_id,
      p_target: data.target,
      p_single_user_id: data.single_user_id ?? null,
    });
    if (error) throw new Error(error.message);
    return { sent: Number(sent ?? 0) };
  });

export const adminCouponSubsidyReport = createClientFn({ method: "GET" })
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await (supabase as any).rpc("admin_coupon_subsidy_report");
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data[0] ?? null : data;
  });

export const adminDeleteCoupon = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({ coupon_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await (supabase as any).rpc("admin_delete_coupon", {
      p_coupon_id: data.coupon_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListReports = createClientFn({ method: "GET" })
  .inputValidator((d) =>
    z.object({
      status: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "reports", ...data },
    });
    if (error || result?.error) throw new Error("فشل تحميل البلاغات");
    return result?.reports ?? [];
  });


export const adminResolveReport = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({
    report_id: z.string().uuid(),
    status: z.enum(["resolved", "closed", "dismissed"]),
    note: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "resolve_report", ...data },
    });
    if (error || result?.error) throw new Error("فشل تحديث البلاغ");
    return { ok: true };
  });


export const adminListFriends = createClientFn({ method: "GET" })
  .inputValidator((d) => z.object({ limit: z.number().int().min(1).max(200).default(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "friends", limit: data.limit },
    });
    if (error || result?.error) throw new Error("فشل تحميل الأصدقاء");
    return result?.friends ?? [];
  });


export const adminListFriendRequests = createClientFn({ method: "GET" })
  .inputValidator((d) => z.object({ limit: z.number().int().min(1).max(200).default(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "friend_requests", limit: data.limit },
    });
    if (error || result?.error) throw new Error("فشل تحميل طلبات الصداقة");
    return result?.requests ?? [];
  });


export const adminDeleteFriendship = async ({ data }: { data: { user1_id: string; user2_id: string } }) => {
  const input = z.object({ user1_id: z.string().uuid(), user2_id: z.string().uuid() }).parse(data);
  const { data: result, error } = await supabase.functions.invoke("admin-users", {
    body: { action: "delete_friendship", ...input },
  });
  if (error || result?.error) throw new Error("فشل حذف الصداقة");
  return { ok: true };
};


export const adminDeleteFriendRequest = async ({ data }: { data: { request_id: string } }) => {
  const input = z.object({ request_id: z.string().uuid() }).parse(data);
  const { data: result, error } = await supabase.functions.invoke("admin-users", {
    body: { action: "delete_friend_request", ...input },
  });
  if (error || result?.error) throw new Error("فشل حذف طلب الصداقة");
  return { ok: true };
};


export const adminListMessages = createClientFn({ method: "GET" })
  .inputValidator((d) =>
    z.object({
      chat_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(200).default(100),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "messages", ...data },
    });
    if (error || result?.error) throw new Error("فشل تحميل الرسائل");
    return result?.messages ?? [];
  });


export const adminDeleteMessage = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({ message_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "delete_message", ...data },
    });
    if (error || result?.error) throw new Error("فشل حذف الرسالة");
    return { ok: true };
  });


export const adminListChats = createClientFn({ method: "GET" })
  .inputValidator((d) => z.object({ limit: z.number().int().min(1).max(200).default(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "chats", limit: data.limit },
    });
    if (error || result?.error) throw new Error("فشل تحميل المحادثات");
    return result?.chats ?? [];
  });


export const adminBroadcastNotification = async ({ data }: { data: {
  target: "all" | "drivers" | "large_drivers" | "workers" | "customers" | "single";
  title: string; body: string; user_id?: string;
} }) => {
  const input = z.object({
    target: z.enum(["all", "drivers", "large_drivers", "workers", "customers", "single"]),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(2000),
    user_id: z.string().uuid().optional(),
  }).parse(data);
  const { data: result, error } = await supabase.functions.invoke("admin-users", {
    body: { action: "broadcast_notification", ...input },
  });
  if (error || result?.error) throw new Error("فشل إرسال الإشعار");
  return { sent: result?.sent ?? 0 };
};


export const adminBroadcastGovernorateNotification = async ({ data }: { data: {
  governorate_key: "baghdad" | "basra" | "nineveh" | "erbil" | "sulaymaniyah" | "duhok" | "kirkuk" | "najaf" | "karbala" | "babil" | "anbar" | "diyala" | "saladin" | "wasit" | "dhiqar" | "maysan" | "muthanna" | "qadisiyah";
  title: string; body: string;
} }) => {
  const input = z.object({
    governorate_key: governorateKeySchema,
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(2000),
  }).parse(data);
  const { data: result, error } = await supabase.functions.invoke("admin-users", {
    body: { action: "broadcast_governorate_notification", ...input },
  });
  if (error || result?.error) throw new Error("فشل إرسال الإشعار للمحافظة");
  return { sent: Number(result?.sent ?? 0) };
};


export const adminListStaffActivity = createClientFn({ method: "GET" })
  .inputValidator((d) => z.object({ limit: z.number().int().min(1).max(200).default(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-governance", {
      body: { action: "staff_activity", limit: data.limit },
    });
    if (error || result?.error) throw new Error("تعذر تحميل سجل نشاط الموظفين");
    return result?.rows ?? [];
  });


export const adminListAuditLogs = createClientFn({ method: "GET" })
  .inputValidator((d) => z.object({ limit: z.number().int().min(1).max(200).default(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-governance", {
      body: { action: "audit_logs", limit: data.limit },
    });
    if (error || result?.error) throw new Error("فشل تحميل السجل");
    return result?.logs ?? [];
  });


export const adminGetDashboardStats = createClientFn({ method: "GET" })
  .handler(async ({ context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "dashboard_stats" },
    });
    if (error || result?.error) throw new Error("تعذر تحميل إحصائيات لوحة الإدارة");
    return result;
  });


export const adminGetLiveLocations = createClientFn({ method: "GET" })
  .handler(async ({ context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "live_map" },
    });
    if (error || result?.error) throw new Error("فشل تحميل المواقع");
    return result?.locations ?? [];
  });


export const adminGetLiveRequests = createClientFn({ method: "GET" })
  .handler(async ({ context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "live_map" },
    });
    if (error || result?.error) throw new Error("فشل تحميل الطلبات");
    return result?.requests ?? [];
  });


export const adminGetMonitoringData = createClientFn({ method: "GET" })
  .handler(async ({ context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "monitoring" },
    });
    if (error || result?.error) throw new Error("فشل تحميل بيانات المراقبة");
    return result;
  });


export const adminGetGovernorateUserStats = createClientFn({ method: "GET" })
  .inputValidator((d) => z.object({}).parse(d))
  .handler(async ({ context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "governorate_stats" },
    });
    if (error || result?.error) throw new Error("تعذر تحميل إحصائيات المحافظات");
    return result?.rows ?? [];
  });


export const adminGetCustomerActivityStats = createClientFn({ method: "GET" })
  .inputValidator((d) => z.object({
    limit: z.number().int().min(1).max(500).default(200),
    offset: z.number().int().min(0).default(0),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "customer_activity_stats", ...data },
    });
    if (error || result?.error) throw new Error("تعذر تحميل إحصائيات الزبائن");
    return result?.report ?? {};
  });


export const adminUpdateUserProfile = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({
    user_id: z.string().uuid(),
    full_name: z.string().trim().min(2).max(100),
    governorate_key: governorateKeySchema.nullable(),
    avatar_base64: z.string().max(7_000_000).optional(),
    avatar_mime: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-users", {
      body: { action: "update_profile", ...data },
    });
    if (error || result?.error) throw new Error("فشل تحديث بيانات المستخدم");
    return result?.profile ?? null;
  });


export const adminGovernanceListStaff = createClientFn({ method: "GET" })
  .inputValidator((d) => z.object({}).parse(d))
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any).rpc("admin_list_managed_staff");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminGovernanceAssignStaff = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({
    target_user_id: z.string().uuid(),
    rank: z.enum(["general_manager", "department_manager", "supervisor", "employee"]),
    department: z.enum(["executive", "customer_service", "finance", "operations", "monitoring"]),
    display_title: z.string().max(100).optional(),
    scope_type: z.enum(["global", "governorate"]),
    scope_governorate: z.string().max(40).nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("admin_assign_staff", {
      p_target_user: data.target_user_id, p_rank: data.rank, p_department: data.department,
      p_display_title: data.display_title ?? null, p_scope_type: data.scope_type,
      p_scope_governorate: data.scope_type === "global" ? null : data.scope_governorate ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminGovernanceChangeRank = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({
    target_user_id: z.string().uuid(),
    rank: z.enum(["general_manager", "department_manager", "supervisor", "employee"]),
    department: z.enum(["executive", "customer_service", "finance", "operations", "monitoring"]).optional(),
    display_title: z.string().max(100).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("admin_change_staff_rank", {
      p_target_user: data.target_user_id, p_new_rank: data.rank,
      p_new_department: data.department ?? null, p_new_display_title: data.display_title ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminGovernanceDeactivateStaff = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({
    target_user_id: z.string().uuid(), reason: z.string().min(3).max(500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("admin_deactivate_staff", {
      p_target_user: data.target_user_id, p_reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminGovernanceGrantPricingPermissions = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({
    target_user_id: z.string().uuid(),
    permission_keys: z.array(z.enum(["pricing.taxi.edit", "pricing.peak.edit"])).min(1).max(2),
    scope_type: z.enum(["global", "governorate"]),
    scope_governorates: z.array(z.enum(["baghdad","basra","nineveh","erbil","sulaymaniyah","duhok","kirkuk","najaf","karbala","babil","anbar","diyala","saladin","wasit","dhiqar","maysan","muthanna","qadisiyah"])).max(18).default([]),
  }).superRefine((value, ctx) => {
    if (value.scope_type === "global" && value.scope_governorates.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "النطاق العام لا يقبل اختيار محافظات" });
    }
    if (value.scope_type === "governorate" && value.scope_governorates.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "اختر محافظة واحدة على الأقل" });
    }
    if (new Set(value.scope_governorates).size !== value.scope_governorates.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "لا تكرر المحافظة" });
    }
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: ids, error } = await (context.supabase as any).rpc("admin_grant_pricing_permissions", {
      p_target_user: data.target_user_id,
      p_permission_keys: data.permission_keys,
      p_scope_type: data.scope_type,
      p_scope_governorates: data.scope_type === "global" ? [] : data.scope_governorates,
      p_expires_at: null,
    });
    if (error) throw new Error(error.message);
    return { ids: ids ?? [] };
  });

export const adminGovernanceGrantPermission = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({
    target_user_id: z.string().uuid(), permission_key: z.string().min(3).max(100),
    scope_type: z.enum(["global", "governorate"]), scope_governorate: z.string().max(40).nullable().optional(),
    expires_at: z.string().datetime().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await (context.supabase as any).rpc("admin_grant_staff_permission", {
      p_target_user: data.target_user_id, p_permission_key: data.permission_key,
      p_scope_type: data.scope_type, p_scope_governorate: data.scope_type === "global" ? null : data.scope_governorate ?? null,
      p_expires_at: data.expires_at ?? null,
    });
    if (error) throw new Error(error.message);
    return { id };
  });

export const adminGovernanceCreateDelegation = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({
    delegate_id: z.string().uuid(), permission_key: z.string().min(3).max(100),
    scope_type: z.enum(["global", "governorate"]), scope_governorate: z.string().max(40).nullable().optional(),
    expires_at: z.string().datetime().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await (context.supabase as any).rpc("admin_create_delegation", {
      p_delegate_id: data.delegate_id, p_permission_key: data.permission_key,
      p_scope_type: data.scope_type, p_scope_governorate: data.scope_type === "global" ? null : data.scope_governorate ?? null,
      p_expires_at: data.expires_at ?? null,
    });
    if (error) throw new Error(error.message);
    return { id };
  });

export const adminGovernanceRevokePermission = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({ grant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("admin_revoke_staff_permission", { p_grant_id: data.grant_id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminGovernanceRevokeDelegation = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({ delegation_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("admin_revoke_delegation", { p_delegation_id: data.delegation_id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminGovernanceReviewApproval = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({
    request_id: z.string().uuid(), decision: z.enum(["approved", "rejected"]), note: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("admin_review_approval", {
      p_request_id: data.request_id, p_decision: data.decision, p_note: data.note ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
