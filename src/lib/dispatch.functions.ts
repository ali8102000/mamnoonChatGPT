import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Dispatch creates offers for nearby/available drivers and advances stage */
export const dispatchRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requestId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: request, error } = await context.supabase
      .from("service_requests")
      .select("id, customer_id, status, type")
      .eq("id", data.requestId)
      .maybeSingle();

    if (error || !request) throw new Error("الطلب غير موجود");
    if (request.customer_id !== context.userId) throw new Error("ليس لديك صلاحية لهذا الطلب");
    if (request.type !== "taxi") return { offers: 0, reason: "not_taxi" };
    if (!["pending", "searching"].includes(request.status)) {
      throw new Error("لا يمكن إعادة توزيع هذا الطلب بهذه الحالة");
    }

    // The database locks the request, enforces ownership, and reuses active offers.
    const { data: offers, error: dispatchError } = await (context.supabase as any).rpc(
      "retry_taxi_dispatch",
      { _request_id: request.id },
    );
    if (dispatchError) throw new Error("تعذّر توزيع الطلب: " + dispatchError.message);
    return {
      offers: Number(offers ?? 0),
      reason: Number(offers ?? 0) > 0 ? "ok" : "no_drivers",
    };
  });

/**
 * Provider accepts a service request offer.
 */
export const acceptServiceRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requestId: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error, data: accepted } = await (context.supabase as any).rpc(
      "accept_service_request",
      { _request_id: data.requestId },
    );
    if (error) throw new Error(error.message);
    if (!accepted) throw new Error("الطلب لم يعد متاحاً");
    return { ok: true };
  });

/**
 * Provider responds to a specific offer (accept/reject/expire).
 */
export const respondToOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        offerId: z.string().min(1),
        action: z.enum(["accept", "reject"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: offer, error: offerError } = await supabase
      .from("request_offers")
      .select("id, request_id, provider_id, status")
      .eq("id", data.offerId)
      .maybeSingle();

    if (offerError || !offer) throw new Error("العرض غير موجود أو انتهت صلاحيته");
    if (offer.provider_id !== userId) throw new Error("هذا العرض ليس موجهاً إليك");
    if (offer.status !== "pending") throw new Error("تمت معالجة هذا العرض مسبقاً");

    if (data.action === "accept") {
      const { data: accepted, error } = await (supabase as any).rpc(
        "accept_service_request",
        { _request_id: offer.request_id },
      );
      if (error) throw new Error(error.message);
      if (!accepted) throw new Error("تعذّر قبول الطلب لأنه لم يعد متاحاً");
      return { ok: true, action: "accepted", accepted: true, requestId: offer.request_id };
    }

    const { data: rejected, error } = await (supabase as any).rpc("reject_request_offer", {
      _offer_id: data.offerId,
    });
    if (error) throw new Error(error.message);
    if (!rejected) throw new Error("انتهت صلاحية العرض أو تمت معالجته");
    return { ok: true, action: "rejected" };
  });

/**
 * Customer cancels a request.
 */
export const cancelRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        requestId: z.string().min(1),
        reason: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("cancel_service_request", {
      _request_id: data.requestId,
      _reason: data.reason ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Provider cancels a request they accepted.
 */
export const providerCancelRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        requestId: z.string().min(1),
        reason: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("cancel_service_request", {
      _request_id: data.requestId,
      _reason: data.reason ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Compatibility read: client retries never reset offers or dispatch deadlines. */
export const retryDispatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requestId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: request, error } = await context.supabase
      .from("service_requests")
      .select("id, customer_id, status, type")
      .eq("id", data.requestId)
      .maybeSingle();

    if (error || !request) throw new Error("الطلب غير موجود");
    if (request.customer_id !== context.userId) throw new Error("ليس لديك صلاحية لهذا الطلب");
    if (request.type !== "taxi" || !["pending", "searching"].includes(request.status)) {
      throw new Error("لا يمكن إعادة توزيع هذا الطلب بهذه الحالة");
    }

    const { data: offers, error: dispatchError } = await (context.supabase as any).rpc(
      "retry_taxi_dispatch",
      { _request_id: request.id },
    );
    if (dispatchError) throw new Error("تعذّر إعادة توزيع الطلب: " + dispatchError.message);
    return {
      offers: Number(offers ?? 0),
      reason: Number(offers ?? 0) > 0 ? "ok" : "no_drivers",
    };
  });

/**
 * Start a ride (provider arrives at pickup).
 */
export const startRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requestId: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error, data: transitioned } = await (context.supabase as any).rpc(
      "transition_service_request",
      { _request_id: data.requestId, _status: "in_progress", _reason: null },
    );
    if (error) throw new Error(error.message);
    if (!transitioned) throw new Error("تعذّر بدء الرحلة");
    return { ok: true };
  });

/**
 * Complete a ride.
 */
export const completeRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requestId: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error, data: transitioned } = await (context.supabase as any).rpc(
      "transition_service_request",
      { _request_id: data.requestId, _status: "completed", _reason: null },
    );
    if (error) throw new Error(error.message);
    if (!transitioned) throw new Error("تعذّر إكمال الطلب");
    return { ok: true };
  });

export type ProviderPin = {
  pin_id: string;
  lat: number;
  lng: number;
  heading: number | null;
};

export const findNearbyProviderPins = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        lat: z.number().finite().min(-90).max(90),
        lng: z.number().finite().min(-180).max(180),
        type: z.enum(["taxi", "service"]),
        category: z.string().trim().max(80).nullable().optional(),
        serviceId: z.string().uuid().nullable().optional(),
        radiusKm: z.number().finite().min(0.1).max(15).default(5),
        limit: z.number().int().min(1).max(30).default(30),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any).rpc("find_nearby_provider_pins", {
      _lat: data.lat,
      _lng: data.lng,
      _type: data.type,
      _category: data.category ?? null,
      _service_id: data.serviceId ?? null,
      _radius_km: data.radiusKm,
      _limit: data.limit,
    });
    if (error) return [];
    return (rows ?? []) as ProviderPin[];
  });
