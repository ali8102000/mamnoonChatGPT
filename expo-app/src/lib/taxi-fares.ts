export type MobileVehicleCategory = "economy" | "premium" | "luxury";

export function calculateMobileTaxiFare(
  category: MobileVehicleCategory,
  distanceKm: number,
  demandMultiplier = 1,
  isIntercity = false,
): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new Error("مسافة الطريق غير صالحة");
  }

  const perKm = isIntercity ? 187.5 : 400;
  const baseFare = distanceKm * perKm;
  const requestedDemand = Math.min(1.5, Math.max(0.8, demandMultiplier));
  const initialFare = baseFare * requestedDemand;
  const adjustedDemand =
    isIntercity || Math.max(baseFare, initialFare) >= 10000
      ? Math.min(1.1, Math.max(0.95, requestedDemand))
      : requestedDemand;
  const economyFare = baseFare * adjustedDemand;
  const tierMultiplier =
    category === "economy"
      ? 1
      : isIntercity || economyFare >= 5000
        ? category === "premium" ? 1.05 : 1.1
        : category === "premium" ? 1.1 : 1.25;

  return Math.max(0, Math.round((economyFare * tierMultiplier) / 250) * 250);
}
