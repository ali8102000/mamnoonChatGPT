// Taxi pricing for Mamnoon: city rides use 400 IQD/km; inter-governorate rides use 187.5 IQD/km.
export type VehicleCategory = "economy" | "premium" | "luxury";
export type WeatherCondition = "heat" | "rain" | "cold" | "mild";
export type RoadCondition = "normal" | "congested";

export interface FareOptions {
  weather?: WeatherCondition;
  roadCondition?: RoadCondition;
  demandMultiplier?: number;
  isIntercity?: boolean;
}

export interface FareBreakdown {
  category: VehicleCategory;
  distanceKm: number;
  baseFare: number;
  distanceFare: number;
  weatherAllowance: number;
  trafficAllowance: number;
  subtotal: number;
  minimumFare: number;
  total: number;
  weatherDescription: string;
  roadDescription: string;
}

export const FARE_TABLE: Record<
  VehicleCategory,
  { base: number; perKm: number; minimum: number; titleAr: string }
> = {
  economy: { base: 0, perKm: 400, minimum: 0, titleAr: "ممنون اقتصادي" },
  premium: { base: 0, perKm: 400, minimum: 0, titleAr: "ممنون المتميز" },
  luxury: { base: 0, perKm: 400, minimum: 0, titleAr: "ممنون فاخر" },
};

export const WEATHER_RATES: Record<
  WeatherCondition,
  { extra: number; label: string; icon: string }
> = {
  heat: { extra: 750, label: "أجواء حارة (تكييف مستمر AC)", icon: "☀️" },
  rain: { extra: 750, label: "أجواء ماطرة وأمطار", icon: "🌧️" },
  cold: { extra: 500, label: "أجواء باردة وشتاء", icon: "❄️" },
  mild: { extra: 0, label: "جو معتدل", icon: "🌤️" },
};

export const ROAD_RATES: Record<RoadCondition, { extra: number; label: string; icon: string }> = {
  normal: { extra: 0, label: "طريق سالك وسريع", icon: "🟢" },
  congested: { extra: 750, label: "طريق مزدحم وساعات ذروة", icon: "🟡" },
};

export const MIN_TAXI_FARE = 0;

export function roundTo250(n: number): number {
  return Math.round(n / 250) * 250;
}

export function calculateFareBreakdown(
  category: VehicleCategory,
  distanceKm: number,
  options?: FareOptions,
): FareBreakdown {
  const t = FARE_TABLE[category];
  if (!Number.isFinite(distanceKm) || distanceKm < 0) throw new Error("مسافة الطريق غير صالحة");

  const isIntercity = options?.isIntercity ?? false;
  const perKm = isIntercity ? 187.5 : t.perKm;
  const distanceFare = perKm * distanceKm;
  const subtotal = distanceFare;
  const requestedDemand = Math.min(1.5, Math.max(0.8, options?.demandMultiplier ?? 1));
  // Long-distance and inter-governorate fares must not surge as sharply as short city rides.
  // Apply the reduced 0.95–1.10 band when either the base or demand-adjusted city fare reaches 10,000 IQD.
  const demandMultiplier =
    isIntercity || Math.max(subtotal, initialEconomyFare) >= 10000
      ? Math.min(1.1, Math.max(0.95, requestedDemand))
      : requestedDemand;

  const economyFare = subtotal * demandMultiplier;
  const tierMultiplier =
    category === "economy"
      ? 1
      : isIntercity || economyFare >= 5000
        ? category === "premium" ? 1.05 : 1.10
        : category === "premium" ? 1.10 : 1.25;

  const weather = options?.weather ?? "heat";
  const roadCondition = options?.roadCondition ?? "normal";
  const weatherData = WEATHER_RATES[weather];
  const roadData = ROAD_RATES[roadCondition];
  const finalTotal = Math.max(MIN_TAXI_FARE, roundTo250(economyFare * tierMultiplier));

  return {
    category,
    distanceKm,
    baseFare: t.base,
    distanceFare: Math.round(distanceFare),
    weatherAllowance: 0,
    trafficAllowance: 0,
    subtotal,
    minimumFare: t.minimum,
    total: finalTotal,
    weatherDescription: weatherData.label,
    roadDescription: roadData.label,
  };
}

export function taxiFare(
  category: VehicleCategory,
  distanceKm: number,
  options?: FareOptions,
): number {
  return calculateFareBreakdown(category, distanceKm, options).total;
}

/** Straight-line distance → approximate realistic road routing distance in Baghdad/Iraqi cities. */
export function approxRoadKm(straightKm: number): number {
  return Number((straightKm * 1.35).toFixed(2));
}
