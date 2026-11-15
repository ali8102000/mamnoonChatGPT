export type MobileVehicleCategory = "economy" | "premium" | "luxury";

export function calculateMobileTaxiFare(
  category: MobileVehicleCategory,
  distanceKm: number,
  demandMultiplier = 1,
  isIntercity = false,
  tripType: "one_way" | "round_trip" | "second_trip" | "stop" = "one_way",
  extraMinutes = 0,
): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new Error("مسافة الطريق غير صالحة");
  }

  const perKm = isIntercity ? 187.5 : 400;
  const baseFare = distanceKm * perKm;
  const requestedDemand = Math.min(1.5, Math.max(0.8, demandMultiplier));
  // Smoothly taper demand uplift as the base fare grows; keep web and Android identical.
  const adjustedDemand = isIntercity
    ? Math.min(1.1, Math.max(0.95, requestedDemand))
    : Math.min(
        requestedDemand,
        1.1 + 0.4 * Math.min(1, Math.max(0, (10000 - baseFare) / 5000)),
      );
  if (!Number.isInteger(extraMinutes) || extraMinutes < 0 || extraMinutes > 120 || extraMinutes % 5 !== 0) {
    throw new Error("مدة الانتظار يجب أن تكون من 5 إلى 120 دقيقة وبفواصل 5 دقائق");
  }
  const economyFare = baseFare * adjustedDemand;
  const tierMultiplier =
    category === "economy"
      ? 1
      : isIntercity || economyFare >= 5000
        ? category === "premium" ? 1.05 : 1.1
        : category === "premium" ? 1.1 : 1.25;

  const tripMultiplier = tripType === "round_trip" || tripType === "second_trip" ? 2 : 1;
  const extraTimeFare = Math.ceil(extraMinutes / 5) * 500;
  return Math.max(0, Math.round((economyFare * tierMultiplier * tripMultiplier + extraTimeFare) / 250) * 250);
}
