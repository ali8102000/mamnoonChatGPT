export type ServerTaxiCategory = "economy" | "premium" | "luxury";
export type ServerTripType = "one_way" | "round_trip" | "second_trip" | "stop";

export type GovernorateTariffRow = {
  governorate_key: string;
  service_type: string;
  [key: string]: unknown;
};

/** Resolve an explicit governorate tariff first, then the global admin tariff. */
export function resolveGovernorateTariff<T extends GovernorateTariffRow>(
  rows: T[],
  governorateKey: string,
  serviceType: ServerTaxiCategory,
): T | undefined {
  return rows.find((row) => row.service_type === serviceType && row.governorate_key === governorateKey)
    ?? rows.find((row) => row.service_type === serviceType && row.governorate_key === "all");
}

/** Shared server-side arithmetic mirrored by public.prepare_taxi_request(). */
export function calculateServerTaxiFare(input: {
  category: ServerTaxiCategory;
  economyRaw: number;
  minFare: number;
  tripType: ServerTripType;
  extraMinutes: number;
  peakPercent: number;
  urgencyPercent: number;
}): number {
  const { category, economyRaw, minFare, tripType, extraMinutes, peakPercent, urgencyPercent } = input;
  if (!Number.isFinite(economyRaw) || economyRaw < 0) throw new Error("invalid_economy_base");
  if (!Number.isFinite(minFare) || minFare < 0) throw new Error("invalid_minimum_fare");
  if (!Number.isInteger(extraMinutes) || extraMinutes < 0 || extraMinutes > 120 || extraMinutes % 5 !== 0) {
    throw new Error("invalid_extra_minutes");
  }
  if (!Number.isFinite(peakPercent) || peakPercent < 0 || peakPercent > 200) throw new Error("invalid_peak_percent");
  if (!Number.isFinite(urgencyPercent) || urgencyPercent < 0 || urgencyPercent > 100) throw new Error("invalid_urgency_percent");

  const tierPercent = category === "economy"
    ? 0
    : category === "premium"
      ? (economyRaw < 10000 ? 20 : economyRaw <= 50000 ? 15 : 5)
      : (economyRaw < 10000 ? 40 : economyRaw <= 50000 ? 25 : 10);
  const tripMultiplier = tripType === "round_trip" ? 1.8 : tripType === "second_trip" ? 2 : 1;
  const extraFare = Math.ceil(extraMinutes / 5) * 500;
  const pricingEconomyBase = Math.max(1000, economyRaw);
  let raw = pricingEconomyBase * (1 + tierPercent / 100) * tripMultiplier + extraFare;
  if (tripType === "round_trip") raw = pricingEconomyBase * (1 + tierPercent / 100) * 2 * 0.9 + extraFare;
  raw *= 1 + peakPercent / 100;
  raw *= 1 + urgencyPercent / 100;
  const total = Math.max(1000, minFare, Math.round(raw / 250) * 250);
  if (!Number.isSafeInteger(total) || total < 1000) throw new Error("invalid_calculated_fare");
  return total;
}
