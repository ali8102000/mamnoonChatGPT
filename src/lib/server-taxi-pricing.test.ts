import { describe, it, expect } from "vitest";
import { taxiFare } from "./taxi-fares";
import { calculateServerTaxiFare, resolveGovernorateTariff } from "../../supabase/functions/_shared/taxi-pricing";

const governorates = [
  "baghdad","basra","nineveh","erbil","sulaymaniyah","duhok","kirkuk","najaf","karbala",
  "babil","anbar","diyala","saladin","wasit","dhiqar","maysan","muthanna","qadisiyah",
];

describe("server taxi pricing safeguards", () => {
  it("resolves a valid global admin tariff for all 18 governorates", () => {
    const rows = [
      { governorate_key: "all", service_type: "economy", per_km_rate: 350 },
      { governorate_key: "all", service_type: "premium", min_fare: 1000 },
      { governorate_key: "all", service_type: "luxury", min_fare: 1000 },
    ];
    for (const key of governorates) {
      expect(resolveGovernorateTariff(rows, key, "economy")?.per_km_rate).toBe(350);
      expect(resolveGovernorateTariff(rows, key, "premium")?.min_fare).toBe(1000);
      expect(resolveGovernorateTariff(rows, key, "luxury")?.min_fare).toBe(1000);
    }
  });

  it("always prefers the exact governorate tariff over the global tariff", () => {
    const rows = [
      { governorate_key: "all", service_type: "economy", per_km_rate: 350 },
      { governorate_key: "najaf", service_type: "economy", per_km_rate: 425 },
    ];
    expect(resolveGovernorateTariff(rows, "najaf", "economy")?.per_km_rate).toBe(425);
    expect(resolveGovernorateTariff(rows, "basra", "economy")?.per_km_rate).toBe(350);
  });

  it("matches the customer fare implementation for all categories, distances and trip modes", () => {
    const distances = [0, 0.625, 5, 8.3, 10, 12.49, 12.5, 15, 68, 250];
    const categories = ["economy", "premium", "luxury"] as const;
    const tripTypes = ["one_way", "round_trip", "second_trip", "stop"] as const;
    const extras = [0, 5, 15, 60, 120];
    let comparisons = 0;
    for (const category of categories) for (const distanceKm of distances) {
      for (const isIntercity of [false, true]) for (const tripType of tripTypes) for (const extraMinutes of extras) {
        const economyRaw = distanceKm * (isIntercity ? 187.5 : 350);
        const expected = taxiFare(category, distanceKm, { isIntercity, tripType, extraMinutes });
        const actual = calculateServerTaxiFare({
          category, economyRaw, minFare: 0, tripType, extraMinutes, peakPercent: 0, urgencyPercent: 0,
        });
        expect(actual).toBe(expected);
        comparisons++;
      }
    }
    expect(comparisons).toBe(1200);
  });

  it("applies admin peak and urgency percentages before final 250-IQD rounding", () => {
    expect(calculateServerTaxiFare({
      category: "economy", economyRaw: 10000, minFare: 1000, tripType: "one_way",
      extraMinutes: 0, peakPercent: 10, urgencyPercent: 10,
    })).toBe(12000);
  });

  it("rejects invalid tariff inputs instead of returning a guessed price", () => {
    expect(() => calculateServerTaxiFare({
      category: "economy", economyRaw: Number.NaN, minFare: 1000, tripType: "one_way",
      extraMinutes: 0, peakPercent: 0, urgencyPercent: 0,
    })).toThrow();
    expect(() => calculateServerTaxiFare({
      category: "economy", economyRaw: 5000, minFare: -1, tripType: "one_way",
      extraMinutes: 0, peakPercent: 0, urgencyPercent: 0,
    })).toThrow();
  });
});
