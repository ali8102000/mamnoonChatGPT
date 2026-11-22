import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

/** Dispatch creates offers for nearby/available drivers and advances stage */
export const dispatchRequest = async ({ data }: { data: { requestId: string } }) => {
  const input = z.object({ requestId: z.string().min(1) }).parse(data);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("سجّل الدخول أولاً");
  const { data: request, error } = await supabase.from("service_requests")
    .select("id, customer_id, status, type")
    .eq("id", input.requestId)
    .maybeSingle();
  if (error || !request) throw new Error("الطلب غير موجود");
  if (request.customer_id !== userData.user.id) throw new Error("ليس لديك صلاحية لهذا الطلب");
  if (request.type !== "taxi") throw new Error("هذا المسار مخصص لطلبات التكسي فقط");
  return { offers: 0, reason: request.status };
};

/** Provider accepts a service request offer. */
export const acceptServiceRequest = async ({ data }: { data: { requestId: string } }) => {
  const input = z.object({ requestId: z.string().min(1) }).parse(data);
  const { error, data: accepted } = await (supabase as any).rpc("accept_service_request", { _request_id: input.requestId });
  if (error) throw new Error(error.message);
  if (!accepted) throw new Error("الطلب لم يعد متاحاً");
  return { ok: true };
};

/** Customer ends service staffing once the available headcount is sufficient. */
export const stopServiceRequestAcceptance = async ({ data }: { data: { requestId: string } }) => {
  const input = z.object({ requestId: z.string().uuid() }).parse(data);
  const { data: stopped, error } = await (supabase as any).rpc("stop_service_request_acceptance", {
    _request_id: input.requestId,
  });
  if (error) throw new Error(error.message);
  if (!stopped) throw new Error("تعذّر إيقاف استقبال الفنيين");
  return { ok: true };
};

/** Provider responds to a specific offer (accept/reject/expire). */
export const respondToOffer = async ({ data }: { data: { offerId: string; action: "accept" | "reject" } }) => {
  const input = z.object({ offerId: z.string().min(1), action: z.enum(["accept", "reject"]) }).parse(data);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("سجّل الدخول أولاً");
  const { data: offer, error: offerError } = await supabase.from("request_offers")
    .select("id, request_id, provider_id, status")
    .eq("id", input.offerId)
    .maybeSingle();
  if (offerError || !offer) throw new Error("العرض غير موجود أو انتهت صلاحيته");
  if (offer.provider_id !== userData.user.id) throw new Error("هذا العرض ليس موجهاً إليك");
  if (offer.status !== "pending") throw new Error("تمت معالجة هذا العرض مسبقاً");
  if (input.action === "accept") {
    const { data: accepted, error } = await (supabase as any).rpc("accept_service_request", { _request_id: offer.request_id });
    if (error) throw new Error(error.message);
    if (!accepted) throw new Error("تعذّر قبول الطلب لأنه لم يعد متاحاً");
    return { ok: true, action: "accepted", accepted: true, requestId: offer.request_id };
  }
  const { data: rejected, error } = await (supabase as any).rpc("reject_request_offer", { _offer_id: input.offerId });
  if (error) throw new Error(error.message);
  if (!rejected) throw new Error("انتهت صلاحية العرض أو تمت معالجته");
  return { ok: true, action: "rejected" };
};

/** Customer cancels a request. */
export const cancelRequest = async ({ data }: { data: { requestId: string; reason?: string } }) => {
  const input = z.object({ requestId: z.string().min(1), reason: z.string().max(500).optional() }).parse(data);
  const { error } = await (supabase as any).rpc("cancel_service_request", {
    _request_id: input.requestId, _reason: input.reason ?? null,
  });
  if (error) {
    console.error("[Mamnoon] Customer cancel_service_request RPC failed", {
      code: error.code, message: error.message, details: error.details, hint: error.hint, requestId: input.requestId,
    });
    throw new Error(error.message);
  }
  return { ok: true };
};

/** Provider cancels a request they accepted. */
export const providerCancelRequest = async ({ data }: { data: { requestId: string; reason?: string } }) => {
  const input = z.object({ requestId: z.string().min(1), reason: z.string().max(500).optional() }).parse(data);
  const { error } = await (supabase as any).rpc("cancel_service_request", {
    _request_id: input.requestId, _reason: input.reason ?? null,
  });
  if (error) {
    console.error("[Mamnoon] Provider cancel_service_request RPC failed", {
      code: error.code, message: error.message, details: error.details, hint: error.hint, requestId: input.requestId,
    });
    throw new Error(error.message);
  }
  return { ok: true };
};

/** Compatibility read: client retries never reset offers or dispatch deadlines. */
export const retryDispatch = async ({ data }: { data: { requestId: string } }) => {
  const input = z.object({ requestId: z.string().min(1) }).parse(data);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("سجّل الدخول أولاً");
  const { data: request, error } = await supabase.from("service_requests")
    .select("id, customer_id, status").eq("id", input.requestId).single();
  if (error || !request) throw new Error("الطلب غير موجود");
  if (request.customer_id !== userData.user.id) throw new Error("ليس لديك صلاحية لهذا الطلب");
  return { offers: 0, reason: request.status };
};

/** Start a ride (provider arrives at pickup). */
export const startRide = async ({ data }: { data: { requestId: string } }) => {
  const input = z.object({ requestId: z.string().min(1) }).parse(data);
  const { error, data: transitioned } = await (supabase as any).rpc("transition_service_request", {
    _request_id: input.requestId, _status: "in_progress", _reason: null,
  });
  if (error) throw new Error(error.message);
  if (!transitioned) throw new Error("تعذّر بدء الرحلة");
  return { ok: true };
};

/** Complete a ride. */
export const completeRide = async ({ data }: { data: { requestId: string } }) => {
  const input = z.object({ requestId: z.string().min(1) }).parse(data);
  const { error, data: transitioned } = await (supabase as any).rpc("transition_service_request", {
    _request_id: input.requestId, _status: "completed", _reason: null,
  });
  if (error) throw new Error(error.message);
  if (!transitioned) throw new Error("تعذّر إكمال الطلب");
  return { ok: true };
};

export type ProviderPin = {
  pin_id: string;
  lat: number;
  lng: number;
  heading: number | null;
};

export const findNearbyProviderPins = async ({ data }: { data: {
  lat: number; lng: number; type: "taxi" | "service"; category?: string | null;
  serviceId?: string | null; radiusKm?: number; limit?: number;
} }) => {
  const input = z.object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    type: z.enum(["taxi", "service"]),
    category: z.string().trim().max(80).nullable().optional(),
    serviceId: z.string().uuid().nullable().optional(),
    radiusKm: z.number().finite().min(0.1).max(25).default(5),
    limit: z.number().int().min(1).max(30).default(30),
  }).parse(data);
  const { data: rows, error } = await (supabase as any).rpc("find_nearby_provider_pins", {
    _lat: input.lat, _lng: input.lng, _type: input.type, _category: input.category ?? null,
    _service_id: input.serviceId ?? null, _radius_km: input.radiusKm, _limit: input.limit,
  });
  if (error) throw new Error("تعذّر تحميل مقدمي الخدمة القريبين");
  return (rows ?? []) as ProviderPin[];
};

/** Customer retries a request that ended only because no provider accepted it. */
export const retryFailedRequest = async ({ data }: { data: { requestId: string; priceIncrease?: number } }) => {
  const input = z.object({
    requestId: z.string().uuid(),
    priceIncrease: z.number().int().min(0).max(50000).multipleOf(250).default(0),
  }).parse(data);
  const { data: count, error } = await (supabase as any).rpc("retry_service_request", {
    _request_id: input.requestId, _price_increase: input.priceIncrease,
  });
  if (error) throw new Error(error.message);
  return { sent: Number(count ?? 0) };
};
