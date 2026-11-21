// Taxi pricing for Mamnoon: city rides use 350 IQD/km; inter-governorate rides use 187.5 IQD/km.
export type VehicleCategory = "economy" | "premium" | "luxury" | "large";
export type WeatherCondition = "heat" | "rain" | "cold" | "mild";
export type RoadCondition = "normal" | "congested";

export interface FareOptions {
  weather?: WeatherCondition;
  roadCondition?: RoadCondition;
  demandMultiplier?: number;
  isIntercity?: boolean;
  tripType?: "one_way" | "round_trip" | "second_trip" | "stop";
  extraMinutes?: number;
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
  economy: { base: 0, perKm: 350, minimum: 0, titleAr: "ممنون اقتصادي" },
  premium: { base: 0, perKm: 350, minimum: 0, titleAr: "ممنون المتميز" },
  luxury: { base: 0, perKm: 350, minimum: 0, titleAr: "ممنون فاخر" },
  large: { base: 0, perKm: 350, minimum: 0, titleAr: "سيارة كبيرة" },
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

export const MIN_TAXI_FARE = 1000;

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
  // Keep fares independent of pickup-zone demand so moving a pin cannot cause price spikes.
  const demandMultiplier = 1;

  const economyFare = subtotal * demandMultiplier;
  const pricingEconomyBase = category === "large" ? economyFare : Math.max(MIN_TAXI_FARE, economyFare);
  const tierPercent = category === "economy" || category === "large"
    ? 0
    : category === "premium"
      ? (economyFare < 10000 ? 20 : economyFare <= 50000 ? 15 : 5)
      : (economyFare < 10000 ? 40 : economyFare <= 50000 ? 25 : 10);
  const tierMultiplier = 1 + tierPercent / 100;

  const weather = options?.weather ?? "heat";
  const roadCondition = options?.roadCondition ?? "normal";
  const weatherData = WEATHER_RATES[weather];
  const roadData = ROAD_RATES[roadCondition];
  const tripMultiplier = options?.tripType === "round_trip" ? 1.8 : options?.tripType === "second_trip" ? 2 : 1;
  const extraMinutes = options?.extraMinutes ?? 0;
  if (!Number.isInteger(extraMinutes) || extraMinutes < 0 || extraMinutes > 120 || extraMinutes % 5 !== 0) {
    throw new Error("مدة الانتظار يجب أن تكون من 5 إلى 120 دقيقة وبفواصل 5 دقائق");
  }
  const extraTimeFare = Math.ceil(extraMinutes / 5) * 500;
  const finalTotal = Math.max(
    category === "large" ? 0 : MIN_TAXI_FARE,
    options?.tripType === "round_trip"
      ? roundTo250(pricingEconomyBase * tierMultiplier * 2 * 0.9 + extraTimeFare)
      : roundTo250(pricingEconomyBase * tierMultiplier * tripMultiplier + extraTimeFare),
  );

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
