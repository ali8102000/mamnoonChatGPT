import { describe, expect, it } from "bun:test";
import { taxiFare } from "../../../src/lib/taxi-fares";
import { calculateMobileTaxiFare } from "./taxi-fares";

describe("web and Android taxi fare parity", () => {
  const distances = [0, 0.625, 5, 8.3, 10, 12.49, 12.5, 15, 68];
  const categories = ["economy", "premium", "luxury"] as const;
  const tripTypes = ["one_way", "round_trip", "second_trip", "stop"] as const;
  const extraMinuteValues = [0, 5, 15, 60, 120];

  it("returns exactly the same fare for every supported category and trip combination", () => {
    for (const category of categories) {
      for (const distanceKm of distances) {
        for (const isIntercity of [false, true]) {
          for (const tripType of tripTypes) {
            for (const extraMinutes of extraMinuteValues) {
              const webFare = taxiFare(category, distanceKm, {
                isIntercity,
                tripType,
                extraMinutes,
              });
              const androidFare = calculateMobileTaxiFare(
                category,
                distanceKm,
                1,
                isIntercity,
                tripType,
                extraMinutes,
              );
              expect(androidFare).toBe(webFare);
            }
          }
        }
      }
    }
  });

  it("rejects invalid distance and waiting-time values on both platforms", () => {
    for (const distanceKm of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(() => taxiFare("economy", distanceKm)).toThrow();
      expect(() => calculateMobileTaxiFare("economy", distanceKm)).toThrow();
    }

    for (const extraMinutes of [-5, 7, 125]) {
      expect(() => taxiFare("economy", 5, { extraMinutes })).toThrow();
      expect(() => calculateMobileTaxiFare("economy", 5, 1, false, "one_way", extraMinutes)).toThrow();
    }
  });
});
