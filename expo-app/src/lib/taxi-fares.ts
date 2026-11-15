export type MobileVehicleCategory = "economy" | "premium" | "luxury";

export function calculateMobileTaxiFare(
  category: MobileVehicleCategory,
  distanceKm: number,
  _demandMultiplier = 1,
  isIntercity = false,
  tripType: "one_way" | "round_trip" | "second_trip" | "stop" = "one_way",
  extraMinutes = 0,
): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new Error("مسافة الطريق غير صالحة");
  }

  const perKm = isIntercity ? 187.5 : 400;
  const baseFare = distanceKm * perKm;
  // Smoothly taper demand uplift as the base fare grows; keep web and Android identical.
  const adjustedDemand = 1; // Geographic demand multipliers caused abrupt fare changes when moving the pickup pin.
  if (!Number.isInteger(extraMinutes) || extraMinutes < 0 || extraMinutes > 120 || extraMinutes % 5 !== 0) {
    throw new Error("مدة الانتظار يجب أن تكون من 5 إلى 120 دقيقة وبفواصل 5 دقائق");
  }
  const economyFare = baseFare * adjustedDemand;
  const categoryTransition = Math.min(1, Math.max(0, (economyFare - 4500) / 1000));
  const tierMultiplier =
    category === "economy"
      ? 1
      : category === "premium"
        ? (isIntercity ? 1.05 : 1.10 - 0.05 * categoryTransition)
        : (isIntercity ? 1.10 : 1.25 - 0.15 * categoryTransition);

  const tripMultiplier = tripType === "round_trip" ? 1.8 : tripType === "second_trip" ? 2 : 1;
  const extraTimeFare = Math.ceil(extraMinutes / 5) * 500;
  return Math.max(0, Math.round((economyFare * tierMultiplier * tripMultiplier + extraTimeFare) / 250) * 250);
}
