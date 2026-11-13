import { describe, it, expect } from "vitest";
import { taxiFare, calculateFareBreakdown } from "./taxi-fares";

describe("Mamnoon city taxi pricing", () => {
  it("keeps economy at 400 IQD/km and rounds to nearest 250", () => {
    expect(taxiFare("economy", 10)).toBe(4000);
    expect(taxiFare("economy", 8.501)).toBe(3500);
    expect(taxiFare("economy", 8.3)).toBe(3250);
  });

  it("adds 10% to premium and 25% to luxury below 5000 IQD", () => {
    expect(taxiFare("premium", 10)).toBe(4500);
    expect(taxiFare("luxury", 10)).toBe(5000);
  });

  it("adds 5% to premium and 10% to luxury from 5000 IQD upward", () => {
    expect(taxiFare("economy", 15)).toBe(6000);
    expect(taxiFare("premium", 15)).toBe(6250);
    expect(taxiFare("luxury", 15)).toBe(6500);
  });

  it("limits demand changes when the base city fare reaches 10000 IQD", () => {
    expect(taxiFare("economy", 20, { demandMultiplier: 1.5 })).toBe(8750);
    expect(taxiFare("economy", 25, { demandMultiplier: 1.5 })).toBe(11000);
    expect(taxiFare("economy", 25, { demandMultiplier: 0.8 })).toBe(9500);
  });

  it("uses 187.5 IQD/km and smaller demand changes for inter-governorate rides", () => {
    expect(taxiFare("economy", 68, { isIntercity: true })).toBe(12750);
    expect(taxiFare("premium", 68, { isIntercity: true })).toBe(13500);
    expect(taxiFare("luxury", 68, { isIntercity: true })).toBe(14000);
    expect(taxiFare("economy", 68, { isIntercity: true, demandMultiplier: 1.5 })).toBe(14000);
  });

  it("does not add weather or traffic charges", () => {
    const fare = calculateFareBreakdown("luxury", 5, {
      weather: "heat",
      roadCondition: "congested",
    });
    expect(fare.weatherAllowance).toBe(0);
    expect(fare.trafficAllowance).toBe(0);
  });

  it("keeps zero distance free and rejects invalid distances", () => {
    expect(taxiFare("economy", 0)).toBe(0);
    expect(taxiFare("economy", 0.625)).toBe(250);
    expect(() => taxiFare("economy", NaN)).toThrow();
  });
});
