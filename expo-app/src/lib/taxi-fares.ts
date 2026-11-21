export type MobileVehicleCategory = "economy" | "premium" | "luxury";

/** Mirrors src/lib/taxi-fares.ts; parity is enforced by taxi-fares-parity.test.ts. */
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
  if (!Number.isInteger(extraMinutes) || extraMinutes < 0 || extraMinutes > 120 || extraMinutes % 5 !== 0) {
    throw new Error("مدة الانتظار يجب أن تكون من 5 إلى 120 دقيقة وبفواصل 5 دقائق");
  }

  const baseFare = distanceKm * (isIntercity ? 187.5 : 350);
  const pricingEconomyBase = Math.max(1000, baseFare);
  const tierPercent = category === "economy"
    ? 0
    : category === "premium"
      ? (baseFare < 10000 ? 20 : baseFare <= 50000 ? 15 : 5)
      : (baseFare < 10000 ? 40 : baseFare <= 50000 ? 25 : 10);
  const tierMultiplier = 1 + tierPercent / 100;
  const tripMultiplier = tripType === "round_trip" ? 1.8 : tripType === "second_trip" ? 2 : 1;
  const extraTimeFare = Math.ceil(extraMinutes / 5) * 500;
  const total = tripType === "round_trip"
    ? Math.round((pricingEconomyBase * tierMultiplier * 2 * 0.9 + extraTimeFare) / 250) * 250
    : Math.round((pricingEconomyBase * tierMultiplier * tripMultiplier + extraTimeFare) / 250) * 250;
  return Math.max(1000, total);
}
