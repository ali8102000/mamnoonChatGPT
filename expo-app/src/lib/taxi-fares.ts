import { taxiFare } from "../../../src/lib/taxi-fares";

export type MobileVehicleCategory = "economy" | "premium" | "luxury";

/** Keep native estimates on the exact same pricing implementation as the web app. */
export function calculateMobileTaxiFare(
  category: MobileVehicleCategory,
  distanceKm: number,
  _demandMultiplier = 1,
  isIntercity = false,
  tripType: "one_way" | "round_trip" | "second_trip" | "stop" = "one_way",
  extraMinutes = 0,
): number {
  return taxiFare(category, distanceKm, { isIntercity, tripType, extraMinutes });
}
