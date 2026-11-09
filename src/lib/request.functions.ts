import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getTrustedDrivingRoute } from "@/lib/maps.server";
import { taxiFare } from "@/lib/taxi-fares";

const taxiRequestInput = z.object({
  pickupLat: z.number().min(-90).max(90),
  pickupLng: z.number().min(-180).max(180),
  pickupText: z.string().trim().min(2).max(300),
  destinationLat: z.number().min(-90).max(90),
  destinationLng: z.number().min(-180).max(180),
  destinationText: z.string().trim().min(2).max(300),
  vehicleCategory: z.enum(["economy", "premium", "luxury"]),
  notes: z.string().trim().max(500).optional(),
});

export const createTaxiRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => taxiRequestInput.parse(data))
  .handler(async ({ data, context }) => {
    const { data: isCustomer, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "customer",
    });
    if (roleError || !isCustomer) throw new Error("هذا الحساب غير مهيأ لطلب الرحلات.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const route = await getTrustedDrivingRoute(
      { lat: data.pickupLat, lng: data.pickupLng },
      { lat: data.destinationLat, lng: data.destinationLng },
    );
    const fare = taxiFare(data.vehicleCategory, route.distanceKm);

    const { data: allowed, error: rateLimitError } = await supabaseAdmin.rpc("consume_taxi_request_slot", {
      _user_id: context.userId,
    });
    if (rateLimitError) throw new Error("تعذر التحقق من عدد الطلبات؛ حاول مرة أخرى.");
    if (!allowed) throw new Error("وصلت للحد المؤقت لطلبات التكسي. انتظر دقيقة وحاول مجدداً.");

    const { data: request, error } = await supabaseAdmin
      .from("service_requests")
      .insert({
        customer_id: context.userId,
        type: "taxi",
        status: "pending",
        vehicle_category: data.vehicleCategory,
        pickup_text: data.pickupText,
        pickup_lat: data.pickupLat,
        pickup_lng: data.pickupLng,
        dest_text: data.destinationText,
        dest_lat: data.destinationLat,
        dest_lng: data.destinationLng,
        distance_km: Number(route.distanceKm.toFixed(2)),
        duration_min: Math.ceil(route.durationMin),
        price_estimate: fare,
        notes: data.notes || null,
      })
      .select("id")
      .single();

    if (error || !request) {
      console.error("[createTaxiRequest]", error?.message ?? "request insert returned no row");
      throw new Error("تعذّر إنشاء طلب التكسي؛ حاول مرة أخرى.");
    }

    return {
      requestId: request.id,
      distanceKm: route.distanceKm,
      durationMin: route.durationMin,
      fare,
    };
  });
