import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Dispatch a request: find nearby drivers in expanding radius (2→5→10 km)
 * and create pending offers for them. Returns count of offers created.
 */
export const dispatchRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requestId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: req, error } = await supabase
      .from("service_requests")
      .select("id, customer_id, type, pickup_lat, pickup_lng, status")
      .eq("id", data.requestId)
      .single();

    if (error || !req) throw new Error("Request not found");
    if (req.customer_id !== userId) throw new Error("Forbidden");
    if (req.type !== "taxi") return { offers: 0, reason: "not_taxi" };
    if (req.pickup_lat == null || req.pickup_lng == null) {
      throw new Error("Missing pickup location");
    }

    // The database function locks the request row, verifies ownership,
    // selects eligible nearby drivers and creates 45-second offers atomically.
    const { data: offers, error: dispatchError } = await supabase.rpc(
      "dispatch_request",
      { _request_id: req.id },
    );
    if (dispatchError) throw new Error("تعذر توزيع الطلب: " + dispatchError.message);
    return { offers: Number(offers ?? 0), reason: Number(offers ?? 0) > 0 ? "ok" : "no_drivers" };
  });

/**
 * Provider accepts a service request offer.
 */
export const acceptServiceRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requestId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("accept_service_request", { _request_id: data.requestId });
    if (error) throw new Error(error.message.includes("request_unavailable") ? "العميل ألغى الطلب أو قبله فني ثاني" : error.message);
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
        offerId: z.string().uuid(),
        action: z.enum(["accept", "reject"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: offer, error } = await supabase
      .from("request_offers")
      .select("id, request_id, provider_id, status")
      .eq("id", data.offerId)
      .single();
    if (error || !offer) throw new Error("Offer not found");
    if (offer.provider_id !== userId) throw new Error("Forbidden");
    

    if (data.action === "accept") {
      const { error: accErr } = await supabase.rpc("accept_service_request", { _request_id: offer.request_id });
      if (accErr) throw new Error(accErr.message.includes("request_unavailable") ? "العميل ألغى الطلب أو قبله كابتن ثاني" : accErr.message);
      return { ok: true, action: "accepted", accepted: true, requestId: offer.request_id };
    } else {
      await supabaseAdmin
        .from("request_offers")
        .delete()
        .eq("id", data.offerId);
      return { ok: true, action: "rejected" };
    }
  });

/**
 * Customer cancels a request.
 */
export const cancelRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      requestId: z.string().uuid(),
      reason: z.string().max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("transition_service_request", { _request_id: data.requestId, _status: "cancelled", _reason: data.reason });
    if (error) throw new Error(error.message.includes("request_finished") ? "الطلب منتهي أصلاً" : "تعذّر الإلغاء: " + error.message);
    return { ok: true };
  });

/**
 * Provider cancels a request they accepted.
 */
export const providerCancelRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      requestId: z.string().uuid(),
      reason: z.string().max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("transition_service_request", { _request_id: data.requestId, _status: "cancelled", _reason: data.reason });
    if (error) throw new Error(error.message.includes("request_finished") ? "الطلب منتهي أصلاً" : "تعذّر الإلغاء: " + error.message);
    return { ok: true };
  });

/**
 * Retry dispatch for a request that is still searching.
 */
export const retryDispatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requestId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: req, error } = await supabase
      .from("service_requests")
      .select("id, customer_id, status, type, pickup_lat, pickup_lng")
      .eq("id", data.requestId)
      .single();

    if (error || !req) throw new Error("Request not found");
    if (req.customer_id !== userId) throw new Error("Forbidden");
    if (req.status !== "searching") throw new Error("Request is not searching");
    if (req.type !== "taxi") return { offers: 0, reason: "not_taxi" };
    if (req.pickup_lat == null || req.pickup_lng == null) {
      throw new Error("Missing pickup location");
    }

    // Reuse the same atomic database dispatcher; never create long-lived
    // offers or bypass the server-side 45-second expiry.
    const { data: offers, error: dispatchError } = await supabase.rpc(
      "dispatch_request",
      { _request_id: req.id },
    );
    if (dispatchError) throw new Error("تعذر إعادة توزيع الطلب: " + dispatchError.message);
    return { offers: Number(offers ?? 0), reason: Number(offers ?? 0) > 0 ? "ok" : "no_drivers" };
  });

/**
 * Start a ride (provider arrives at pickup).
 */
export const startRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requestId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("transition_service_request", {
      _request_id: data.requestId,
      _status: "in_progress",
    });
    if (error) throw new Error(error.message.includes("invalid_status_transition")
      ? "لا يمكن بدء الرحلة بهذه الحالة"
      : error.message);
    return { ok: true };
  });

/**
 * Complete a ride.
 */
export const completeRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requestId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("transition_service_request", {
      _request_id: data.requestId,
      _status: "completed",
    });
    if (error) throw new Error(error.message.includes("invalid_status_transition")
      ? "لا يمكن إنهاء الرحلة بهذه الحالة"
      : error.message);
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
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        type: z.enum(["taxi", "service"]),
        category: z.string().nullable().optional(),
        serviceId: z.string().uuid().nullable().optional(),
        radiusKm: z.number().min(0.1).max(20).default(5),
        limit: z.number().int().min(1).max(50).default(30),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc(
      "find_nearby_provider_pins",
      {
        _lat: data.lat,
        _lng: data.lng,
        _type: data.type,
        _category: data.category ?? null,
        _service_id: data.serviceId ?? null,
        _radius_km: data.radiusKm,
        _limit: data.limit,
      },
    );
    if (error) return [];
    return (rows ?? []) as ProviderPin[];
  });
