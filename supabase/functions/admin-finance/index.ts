import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import { getSupabasePublishableKey, getSupabaseSecretKey, createSupabaseFetch } from "../_shared/api-keys.ts";

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
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const targets = ["customers", "single", "customers_1", "customers_2", "customers_3", "customers_4", "customers_5"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const url = required("SUPABASE_URL");
    const anon = getSupabasePublishableKey();
    const service = getSupabaseSecretKey();
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) return json({ error: "unauthorized" }, 401);

    const caller = createClient(url, anon, {
      global: { fetch: createSupabaseFetch(anon), headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await caller.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "unauthorized" }, 401);
    const admin = createClient(url, service, { global: { fetch: createSupabaseFetch(service) }, auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== "string") return json({ error: "invalid_request" }, 400);
    const requirePermission = async (permissionKey: string, scopeType = "global", scopeGovernorate: string | null = null) => {
      const { data: permission, error: permissionError } = await caller.rpc("admin_has_permission", {
        p_permission_key: permissionKey, p_scope_type: scopeType, p_scope_governorate: scopeGovernorate,
      });
      if (!permissionError && permission === true) return;
      const { data: adminAccess } = await caller.rpc("has_admin_access", { p_user_id: auth.user.id });
      if (adminAccess !== true) throw new Error("permission_required:" + permissionKey);
    };
    const requireStrictPermission = async (permissionKey: string) => {
      const { data, error } = await caller.rpc("admin_has_permission", {
        p_permission_key: permissionKey,
        p_scope_type: "global",
        p_scope_governorate: null,
      });
      if (error || data !== true) throw new Error("permission_required:" + permissionKey);
    };
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await caller.rpc(name, args);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, data });
    };

    if (body.action === "refund_cases_list") {
      const { data: assignment, error: assignmentError } = await caller.from("staff_assignments")
        .select("scope_type,scope_governorate").eq("user_id", auth.user.id).eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (assignmentError) return json({ error: "finance_scope_load_failed" }, 500);
      const scopeType = assignment?.scope_type === "governorate" ? "governorate" : "global";
      const scopeGovernorate = scopeType === "governorate" ? assignment?.scope_governorate ?? null : null;
      const { data: canReadRefunds, error: refundReadError } = await caller.rpc("admin_has_permission", {
        p_permission_key: "finance.refund.read",
        p_scope_type: scopeType,
        p_scope_governorate: scopeGovernorate,
      });
      if (refundReadError || canReadRefunds !== true) {
        return json({ error: "permission_required:finance.refund.read" }, 403);
      }

      const status = ["pending_review", "approved", "rejected", "refunded"].includes(body.status)
        ? body.status : null;
      let query = admin.from("mamnoon_zaincash_refund_cases").select("*")
        .order("created_at", { ascending: false }).limit(150);
      if (status) query = query.eq("status", status);
      const { data: cases, error: casesError } = await query;
      if (casesError) return json({ error: "refund_cases_load_failed" }, 500);
      const requestIds = [...new Set((cases ?? []).map((row: any) => row.request_id))];
      const customerIds = [...new Set((cases ?? []).map((row: any) => row.customer_id))];
      const paymentIds = [...new Set((cases ?? []).map((row: any) => row.payment_id))];
      const [{ data: requests, error: requestsError }, { data: profiles, error: profilesError }, { data: payments, error: paymentsError }] = await Promise.all([
        requestIds.length ? admin.from("service_requests").select("id,request_code,type,status,cancellation_reason,governorate_key,customer_id,created_at").in("id", requestIds) : Promise.resolve({ data: [], error: null }),
        customerIds.length ? admin.from("profiles").select("id,full_name,phone").in("id", customerIds) : Promise.resolve({ data: [], error: null }),
        paymentIds.length ? admin.from("payment_transactions").select("id,amount,currency,status,gateway_transaction_id,paid_at,provider,metadata").in("id", paymentIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (requestsError || profilesError || paymentsError) return json({ error: "refund_case_details_load_failed" }, 500);
      const requestMap = new Map((requests ?? []).map((row: any) => [row.id, row]));
      const profileMap = new Map((profiles ?? []).map((row: any) => [row.id, row]));
      const paymentMap = new Map((payments ?? []).map((row: any) => [row.id, row]));
      const caseIds = (cases ?? []).map((row: any) => row.id);
      const { data: events, error: eventsError } = caseIds.length
        ? await admin.from("mamnoon_zaincash_refund_events").select("id,refund_case_id,event_type,actor_id,note,reference,amount_iqd,created_at").in("refund_case_id", caseIds).order("created_at", { ascending: true })
        : { data: [], error: null };
      if (eventsError) return json({ error: "refund_case_events_load_failed" }, 500);
      const actorIds = [...new Set((events ?? []).map((event: any) => event.actor_id).filter(Boolean))];
      const { data: actors, error: actorsError } = actorIds.length
        ? await admin.from("profiles").select("id,full_name,phone").in("id", actorIds)
        : { data: [], error: null };
      if (actorsError) return json({ error: "refund_case_actors_load_failed" }, 500);
      const actorMap = new Map((actors ?? []).map((row: any) => [row.id, row]));
      const visibleCases = (cases ?? []).filter((row: any) => {
        const request = requestMap.get(row.request_id) as any;
        return scopeType !== "governorate" || !scopeGovernorate || request?.governorate_key === scopeGovernorate;
      }).map((row: any) => ({
        ...row,
        request: requestMap.get(row.request_id) ?? null,
        customer: profileMap.get(row.customer_id) ?? null,
        payment: paymentMap.get(row.payment_id) ?? null,
        events: (events ?? []).filter((event: any) => event.refund_case_id === row.id).map((event: any) => ({ ...event, actor: actorMap.get(event.actor_id) ?? null })),
      }));
      const { data: canRefund } = await caller.rpc("admin_has_permission", {
        p_permission_key: "finance.refund",
        p_scope_type: scopeType,
        p_scope_governorate: scopeGovernorate,
      });
      return json({ cases: visibleCases, can_view: true, can_decide: canRefund === true });
    }

    if (body.action === "refund_case_decide") {
      if (!uuid(body.refund_case_id) || !["approved", "rejected"].includes(body.decision) ||
          (body.note !== undefined && (typeof body.note !== "string" || body.note.trim().length > 500))) {
        return json({ error: "invalid_request" }, 400);
      }
      const { data: refundCase, error: caseError } = await admin.from("mamnoon_zaincash_refund_cases")
        .select("id,request_id,customer_id,status,amount_iqd").eq("id", body.refund_case_id).maybeSingle();
      if (caseError || !refundCase) return json({ error: "refund_case_not_found" }, 404);
      const { data: request, error: requestError } = await admin.from("service_requests")
        .select("governorate_key,request_code").eq("id", refundCase.request_id).maybeSingle();
      if (requestError || !request) return json({ error: "request_not_found" }, 404);
      const { data: assignment } = await caller.from("staff_assignments")
        .select("scope_type,scope_governorate").eq("user_id", auth.user.id).eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const scopeType = assignment?.scope_type === "governorate" ? "governorate" : "global";
      const scopeGovernorate = scopeType === "governorate" ? assignment?.scope_governorate ?? null : null;
      if (scopeType === "governorate" && scopeGovernorate !== request.governorate_key) {
        return json({ error: "refund_case_outside_finance_scope" }, 403);
      }
      const { data: canRefund, error: refundPermissionError } = await caller.rpc("admin_has_permission", {
        p_permission_key: "finance.refund",
        p_scope_type: scopeType,
        p_scope_governorate: scopeGovernorate,
      });
      if (refundPermissionError || canRefund !== true) return json({ error: "permission_required" }, 403);
      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (body.decision === "rejected" && note.length < 2) return json({ error: "rejection_reason_required" }, 400);
      const { data: decisionResult, error: decisionError } = await admin.rpc("admin_decide_zaincash_refund", {
        p_refund_case_id: refundCase.id,
        p_decision: body.decision,
        p_note: note,
        p_actor_id: auth.user.id,
      });
      if (decisionError) return json({ error: decisionError.message }, 409);
      return json({ ok: true, data: decisionResult });
    }

    if (body.action === "refund_case_mark_refunded") {
      if (!uuid(body.refund_case_id) || typeof body.refund_reference !== "string" ||
          body.refund_reference.trim().length < 2 || body.refund_reference.trim().length > 120) {
        return json({ error: "invalid_refund_details" }, 400);
      }
      const { data: refundCase, error: caseError } = await admin.from("mamnoon_zaincash_refund_cases")
        .select("id,request_id,status").eq("id", body.refund_case_id).maybeSingle();
      if (caseError || !refundCase) return json({ error: "refund_case_not_found" }, 404);
      const { data: request, error: requestError } = await admin.from("service_requests")
        .select("governorate_key").eq("id", refundCase.request_id).maybeSingle();
      if (requestError || !request) return json({ error: "request_not_found" }, 404);
      const { data: assignment } = await caller.from("staff_assignments")
        .select("scope_type,scope_governorate").eq("user_id", auth.user.id).eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const scopeType = assignment?.scope_type === "governorate" ? "governorate" : "global";
      const scopeGovernorate = scopeType === "governorate" ? assignment?.scope_governorate ?? null : null;
      if (scopeType === "governorate" && scopeGovernorate !== request.governorate_key) {
        return json({ error: "refund_case_outside_finance_scope" }, 403);
      }
      const { data: canRefund, error: refundPermissionError } = await caller.rpc("admin_has_permission", {
        p_permission_key: "finance.refund",
        p_scope_type: scopeType,
        p_scope_governorate: scopeGovernorate,
      });
      if (refundPermissionError || canRefund !== true) return json({ error: "permission_required" }, 403);
      const { data, error } = await admin.rpc("admin_mark_zaincash_refund", {
        p_refund_case_id: refundCase.id,
        p_refund_reference: body.refund_reference.trim(),
        p_actor_id: auth.user.id,
        p_refunded_at: new Date().toISOString(),
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, data });
    }

    if (body.action === "provider_payables_search") {
      const { data: assignment, error: assignmentError } = await caller.from("staff_assignments")
        .select("scope_type,scope_governorate").eq("user_id", auth.user.id).eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (assignmentError) return json({ error: "finance_scope_load_failed" }, 500);
      const scopeType = assignment?.scope_type === "governorate" ? "governorate" : "global";
      const scopeGovernorate = scopeType === "governorate" ? assignment?.scope_governorate ?? null : null;
      await requirePermission("finance.read", scopeType, scopeGovernorate);
      const query = typeof body.query === "string" ? body.query.trim().slice(0, 80) : "";
      if (query.length < 2) return json({ error: "query_too_short" }, 400);
      const safe = query.replace(/[,%()]/g, " ");
      let profileSearch = admin.from("profiles")
        .select("id,full_name,phone,email,governorate_key")
        .or("phone.ilike.%" + safe + "%,full_name.ilike.%" + safe + "%");
      if (scopeType === "governorate" && scopeGovernorate) {
        profileSearch = profileSearch.eq("governorate_key", scopeGovernorate);
      }
      const { data: profiles, error: profileError } = await profileSearch
        .order("created_at", { ascending: false }).limit(30);
      if (profileError) return json({ error: "provider_search_failed" }, 500);
      const ids = (profiles ?? []).map((profile: any) => profile.id);
      if (!ids.length) return json({ providers: [] });
      const { data: roleRows, error: roleError } = await admin.from("user_roles")
        .select("user_id,role").in("user_id", ids).in("role", ["driver", "worker", "large_driver"]);
      if (roleError) return json({ error: "provider_roles_load_failed" }, 500);
      const roleMap = new Map<string, string[]>();
      for (const row of roleRows ?? []) {
        const current = roleMap.get(row.user_id) ?? [];
        current.push(String(row.role));
        roleMap.set(row.user_id, current);
      }
      return json({
        providers: (profiles ?? []).filter((profile: any) => roleMap.has(profile.id))
          .map((profile: any) => ({ ...profile, roles: roleMap.get(profile.id) ?? [] })),
      });
    }

    if (body.action === "provider_payables_detail") {
      if (!uuid(body.provider_id)) return json({ error: "invalid_provider_id" }, 400);
      const { data: assignment, error: assignmentError } = await caller.from("staff_assignments")
        .select("scope_type,scope_governorate").eq("user_id", auth.user.id).eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (assignmentError) return json({ error: "finance_scope_load_failed" }, 500);
      const scopeType = assignment?.scope_type === "governorate" ? "governorate" : "global";
      const scopeGovernorate = scopeType === "governorate" ? assignment?.scope_governorate ?? null : null;
      await requirePermission("finance.read", scopeType, scopeGovernorate);
      const { data: profile, error: profileError } = await admin.from("profiles")
        .select("id,full_name,phone,email,governorate_key")
        .eq("id", body.provider_id).maybeSingle();
      if (profileError || !profile) return json({ error: "provider_not_found" }, 404);
      if (scopeType === "governorate" && scopeGovernorate && profile.governorate_key !== scopeGovernorate) {
        return json({ error: "provider_outside_finance_scope" }, 403);
      }
      const { data: roleRows, error: roleError } = await admin.from("user_roles")
        .select("role").eq("user_id", body.provider_id)
        .in("role", ["driver", "worker", "large_driver"]);
      if (roleError || !roleRows?.length) return json({ error: "provider_account_required" }, 400);

      const permissionScopeType = profile.governorate_key ? "governorate" : "global";
      const permissionScopeGovernorate = profile.governorate_key ?? null;
      const [financePermission, adminAccess] = await Promise.all([
        caller.rpc("admin_has_permission", {
          p_permission_key: "finance.wallet.adjust",
          p_scope_type: permissionScopeType,
          p_scope_governorate: permissionScopeGovernorate,
        }),
        caller.rpc("has_admin_access", { p_user_id: auth.user.id }),
      ]);
      const canSettle = adminAccess.data === true || (!financePermission.error && financePermission.data === true);
      const { data: requests, error: requestsError, count: requestCount } = await admin.from("service_requests")
        .select("id,request_code,type,status,customer_id,commission,customer_price,price_estimate,customer_payable,completed_at,created_at,governorate_key", { count: "exact" })
        .eq("provider_id", body.provider_id).eq("status", "completed").eq("payment_method", "zaincash")
        .order("completed_at", { ascending: false }).limit(500);
      if (requestsError) return json({ error: "provider_payable_requests_load_failed" }, 500);

      const requestIds = (requests ?? []).map((request: any) => request.id);
      let payments: any[] = [];
      let providerPaymentCount = 0;
      if (requestIds.length) {
        const { data, error, count: paymentCount } = await admin.from("payment_transactions")
          .select("id,request_id,user_id,provider,currency,amount,paid_at,gateway_transaction_id", { count: "exact" })
          .eq("purpose", "service_request").eq("status", "paid")
          .eq("provider", "zaincash").eq("currency", "IQD")
          .in("request_id", requestIds).order("paid_at", { ascending: false });
        if (error) return json({ error: "provider_payments_load_failed" }, 500);
        payments = data ?? [];
        providerPaymentCount = paymentCount ?? 0;
      }
      const paymentsByRequest = new Map<string, any[]>();
      for (const payment of payments) {
        const current = paymentsByRequest.get(payment.request_id) ?? [];
        current.push(payment);
        paymentsByRequest.set(payment.request_id, current);
      }
      const requestItems = (requests ?? []).map((request: any) => {
        const requestPayments = (paymentsByRequest.get(request.id) ?? []).filter((payment: any) =>
          payment.user_id === request.customer_id && payment.provider === "zaincash" && payment.currency === "IQD"
        );
        const gross = requestPayments.reduce((sum: number, payment: any) => sum + Number(payment.amount ?? 0), 0);
        const commission = Math.min(gross, Math.max(0, Math.round(Number(request.commission ?? 0))));
        return {
          request_id: request.id,
          request_code: request.request_code,
          request_type: request.type,
          completed_at: request.completed_at ?? request.created_at,
          gross_paid_iqd: gross,
          commission_iqd: commission,
          payable_iqd: Math.max(0, gross - commission),
          payments: requestPayments,
        };
      }).filter((item: any) => item.gross_paid_iqd > 0);
      const { data: settlements, error: settlementsError, count: settlementCount } = await admin.from("mamnoon_provider_cash_settlements")
        .select("id,amount_iqd,note,created_at,created_by,idempotency_key", { count: "exact" })
        .eq("provider_id", body.provider_id).order("created_at", { ascending: false }).limit(500);
      if (settlementsError) return json({ error: "provider_settlements_load_failed" }, 500);
      const { data: summary, error: summaryError } = await caller.rpc("admin_get_provider_payables_summary", {
        p_provider_id: body.provider_id,
      });
      if (summaryError || !summary) return json({ error: "provider_payable_summary_failed" }, 500);
      const historyTruncated = (requestCount ?? 0) > 500 ||
        (settlementCount ?? 0) > 500 || (providerPaymentCount ?? 0) > 1000;
      return json({
        provider: { ...profile, roles: roleRows.map((row: any) => String(row.role)) },
        can_settle: canSettle,
        summary,
        history_truncated: historyTruncated,
        requests: requestItems,
        settlements: settlements ?? [],
      });
    }

    if (body.action === "record_provider_cash_settlement") {
      if (!uuid(body.provider_id) || !Number.isSafeInteger(body.amount_iqd) ||
          body.amount_iqd <= 0 || body.amount_iqd > 1000000000 ||
          typeof body.note !== "string" || body.note.trim().length < 2 || body.note.length > 500 ||
          typeof body.idempotency_key !== "string" || !uuid(body.idempotency_key)) {
        return json({ error: "invalid_request" }, 400);
      }
      const { data: targetProfile, error: targetProfileError } = await admin.from("profiles")
        .select("governorate_key").eq("id", body.provider_id).maybeSingle();
      if (targetProfileError || !targetProfile) return json({ error: "provider_not_found" }, 404);
      const governorate = targetProfile.governorate_key ?? null;
      await requirePermission("finance.wallet.adjust", governorate ? "governorate" : "global", governorate);
      const { data, error } = await caller.rpc("admin_record_provider_cash_settlement", {
        p_provider_id: body.provider_id,
        p_amount_iqd: body.amount_iqd,
        p_note: body.note.trim(),
        p_idempotency_key: body.idempotency_key,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, data });
    }

    if (body.action === "search_users") {
      const { data: assignment } = await caller.from("staff_assignments")
        .select("scope_type,scope_governorate").eq("user_id", auth.user.id).eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const scopeType = assignment?.scope_type === "governorate" ? "governorate" : "global";
      const scopeGovernorate = scopeType === "governorate" ? assignment?.scope_governorate ?? null : null;
      await requirePermission("finance.wallet.adjust", scopeType, scopeGovernorate);
      const query = typeof body.query === "string" ? body.query.trim().slice(0, 80) : "";
      if (query.length < 2) return json({ error: "query_too_short" }, 400);
      const safe = query.replace(/[,%()]/g, " ");
      let search = admin.from("profiles").select("id,full_name,phone,email")
        .or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%`);
      if (scopeType === "governorate" && scopeGovernorate) search = search.eq("governorate_key", scopeGovernorate);
      const { data, error } = await search.order("created_at", { ascending: false }).limit(30);
      if (error) return json({ error: "user_search_failed" }, 500);
      return json({ users: data ?? [] });
    }

    // Keep the combined payload consumed by the native admin finance screen.
    if (body.action === "list") {
      await requirePermission("finance.read");
      await requirePermission("promotions.read");
      const [transactions, coupons] = await Promise.all([
        admin.from("account_wallet_transactions").select("*, profiles!inner(full_name,phone)")
          .order("created_at", { ascending: false }).limit(200),
        admin.from("coupons").select("*").order("created_at", { ascending: false }).limit(200),
      ]);
      if (transactions.error || coupons.error) return json({ error: "finance_data_load_failed" }, 500);
      const walletTransactions = (transactions.data ?? []).map((row: any) => ({
        ...row,
        type: row.transaction_type,
        amount: row.amount_iqd,
        balance_after: row.balance_after_iqd,
        note: row.description,
        currency: "IQD",
      }));
      return json({ transactions: walletTransactions, coupons: coupons.data ?? [] });
    }

    if (body.action === "list_transactions") {
      await requireStrictPermission("finance.read");
      const limit = Number.isInteger(body.limit) ? Math.max(1, Math.min(200, body.limit)) : 100;
      const { data, error } = await admin.from("account_wallet_transactions")
        .select("*, profiles!inner(full_name,phone)")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return json({ error: "transactions_load_failed" }, 500);
      const walletTransactions = (data ?? []).map((row: any) => ({
        ...row,
        type: row.transaction_type,
        amount: row.amount_iqd,
        balance_after: row.balance_after_iqd,
        note: row.description,
        currency: "IQD",
      }));
      return json({ transactions: walletTransactions });
    }

    if (body.action === "list_coupons") {
      await requireStrictPermission("promotions.read");
      const { data, error } = await admin.from("coupons")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) return json({ error: "coupons_load_failed" }, 500);
      return json({ coupons: data ?? [] });
    }

    if (body.action === "adjust_wallet") {
      if (!uuid(body.user_id) || typeof body.amount !== "number" || !Number.isSafeInteger(body.amount) ||
          body.amount <= 0 || body.amount > 100000000 ||
          !["credit", "debit"].includes(body.type) ||
          typeof body.idempotency_key !== "string" || body.idempotency_key.length < 8 || body.idempotency_key.length > 200 ||
          typeof body.note !== "string" || body.note.trim().length < 2 || body.note.length > 500) {
        return json({ error: "invalid_request" }, 400);
      }
      const { data: targetProfile, error: targetProfileError } = await admin.from("profiles")
        .select("governorate_key").eq("id", body.user_id).maybeSingle();
      if (targetProfileError || !targetProfile) return json({ error: "user_not_found" }, 404);
      const governorate = targetProfile.governorate_key ?? null;
      await requirePermission(
        "finance.wallet.adjust",
        governorate ? "governorate" : "global", governorate,
      );
      // Use the canonical ledger read by provider apps, not the legacy driver_wallets ledger.
      return await rpc("admin_adjust_account_wallet", {
        p_user_id: body.user_id,
        p_amount_iqd: body.amount,
        p_note: body.note.trim(),
        p_type: body.type,
        p_idempotency_key: body.idempotency_key,
      });
    }

    if (body.action === "save_coupon") {
      if ((body.id !== undefined && !uuid(body.id)) ||
          typeof body.code !== "string" || body.code.trim().length < 2 || body.code.length > 50 ||
          !["percentage", "fixed"].includes(body.type) ||
          typeof body.value !== "number" || !Number.isFinite(body.value) || body.value < 0 ||
          !Number.isInteger(body.max_uses) || body.max_uses < 1 || body.max_uses > 10000000 ||
          typeof body.active !== "boolean" ||
          typeof body.min_amount !== "number" || !Number.isFinite(body.min_amount) || body.min_amount < 0 ||
          (body.expires_at !== null && body.expires_at !== undefined &&
            (typeof body.expires_at !== "string" || !Number.isFinite(Date.parse(body.expires_at))))) {
        return json({ error: "invalid_request" }, 400);
      }
      const applicableRequestTypes = Array.isArray(body.applicable_request_types) ? body.applicable_request_types : ["taxi"];
      const applicableVehicleCategories = Array.isArray(body.applicable_vehicle_categories) ? body.applicable_vehicle_categories : ["economy","premium","luxury","large"];
      const applicableServiceSlugs = Array.isArray(body.applicable_service_slugs) ? body.applicable_service_slugs : [];
      if (!applicableRequestTypes.length || applicableRequestTypes.some((v: unknown) => !["taxi","service"].includes(String(v))) ||
          applicableVehicleCategories.some((v: unknown) => !["economy","premium","luxury","large"].includes(String(v))) ||
          applicableServiceSlugs.some((v: unknown) => typeof v !== "string" || v.length < 1 || v.length > 100)) {
        return json({ error: "invalid_coupon_service_targeting" }, 400);
      }
      await requirePermission("promotions.manage");
      return await rpc("admin_save_coupon_v2", {
        p_id: body.id ?? null, p_code: body.code.trim().toUpperCase(),
        p_type: body.type, p_value: body.value, p_max_uses: body.max_uses,
        p_expires_at: body.expires_at ?? null, p_active: body.active,
        p_min_amount: body.min_amount,
        p_applicable_request_types: applicableRequestTypes,
        p_applicable_vehicle_categories: applicableVehicleCategories,
        p_applicable_service_slugs: applicableServiceSlugs,
      });
    }

    if (body.action === "audience_count") {
      await requirePermission("promotions.read");
      if (!targets.includes(body.target)) return json({ error: "invalid_target" }, 400);
      const { data, error } = await caller.rpc("admin_coupon_audience_count", { p_target: body.target });
      if (error) return json({ error: error.message }, 400);
      return json({ count: Number(data ?? 0) });
    }

    if (body.action === "distribute_coupon") {
      if (!uuid(body.coupon_id) || !targets.includes(body.target) ||
          (body.target === "single" ? !uuid(body.single_user_id) :
            (body.single_user_id !== undefined && !uuid(body.single_user_id)))) {
        return json({ error: "invalid_request" }, 400);
      }
      await requirePermission("promotions.manage");
      const { data, error } = await caller.rpc("admin_distribute_coupon", {
        p_coupon_id: body.coupon_id, p_target: body.target,
        p_single_user_id: body.single_user_id ?? null,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ sent: Number(data ?? 0) });
    }

    if (body.action === "subsidy_report") {
      await requirePermission("promotions.read");
      const { data, error } = await caller.rpc("admin_coupon_subsidy_report");
      if (error) return json({ error: error.message }, 400);
      return json({ report: Array.isArray(data) ? data[0] ?? null : data });
    }

    if (body.action === "delete_coupon") {
      if (!uuid(body.coupon_id)) return json({ error: "invalid_coupon_id" }, 400);
      await requirePermission("promotions.manage");
      return await rpc("admin_delete_coupon", { p_coupon_id: body.coupon_id });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    const message = String(error);
    if (message.includes("missing_")) return json({ error: "server_configuration_incomplete" }, 503);
    if (message.includes("permission_required:")) return json({ error: "permission_required" }, 403);
    return json({ error: "internal_error" }, 500);
  }
});
