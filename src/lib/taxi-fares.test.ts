import { describe, it, expect } from "vitest";
import { taxiFare, calculateFareBreakdown } from "./taxi-fares";

describe("Mamnoon city taxi pricing", () => {
  it("keeps economy at 350 IQD/km and rounds to nearest 250", () => {
    expect(taxiFare("economy", 10)).toBe(3500);
    expect(taxiFare("economy", 8.501)).toBe(3000);
    expect(taxiFare("economy", 8.3)).toBe(3000);
  });

  it("prices large vehicles at the standard base rate", () => {
    expect(taxiFare("large", 10)).toBe(3500);
  });

  it("applies 20% premium and 40% luxury below 10,000 IQD", () => {
    expect(taxiFare("premium", 10)).toBe(4250);
    expect(taxiFare("luxury", 10)).toBe(5000);
  });

  it("applies the 20% and 40% tiers below 10,000 IQD", () => {
    expect(taxiFare("economy", 15)).toBe(5250);
    expect(taxiFare("premium", 15)).toBe(6250);
    expect(taxiFare("luxury", 15)).toBe(7250);
  });

  it("applies the middle tier from 10,000 through 50,000 IQD", () => {
    expect(taxiFare("premium", 25)).toBe(10500);
    expect(taxiFare("luxury", 25)).toBe(12250);
  });

  it("ignores geographic demand multipliers so nearby pin movement cannot multiply fares", () => {
    expect(taxiFare("economy", 10, { demandMultiplier: 1.5 })).toBe(3500);
    expect(taxiFare("economy", 10, { demandMultiplier: 0.8 })).toBe(3500);
    expect(taxiFare("economy", 10.01, { demandMultiplier: 1.5 })).toBe(3500);
  });

  it("uses the current tier percentages for inter-governorate rides", () => {
    expect(taxiFare("economy", 68, { isIntercity: true })).toBe(12750);
    expect(taxiFare("premium", 68, { isIntercity: true })).toBe(14750);
    expect(taxiFare("luxury", 68, { isIntercity: true })).toBe(16000);
    expect(taxiFare("economy", 68, { isIntercity: true, demandMultiplier: 1.5 })).toBe(12750);
  });

  it("adds a return or second trip and charges 500 IQD per five extra minutes", () => {
    expect(taxiFare("economy", 5, { tripType: "round_trip" })).toBe(3250);
    expect(taxiFare("economy", 5, { tripType: "second_trip" })).toBe(3500);
    expect(taxiFare("economy", 10, { tripType: "round_trip" })).toBe(6250);
    expect(taxiFare("premium", 10, { tripType: "round_trip" })).toBe(7500);
    expect(taxiFare("economy", 5, { extraMinutes: 5 })).toBe(2250);
    expect(taxiFare("economy", 5, { extraMinutes: 120 })).toBe(13750);
    expect(taxiFare("economy", 10, { tripType: "stop", extraMinutes: 10 })).toBe(4500);
    expect(() => taxiFare("economy", 5, { extraMinutes: 7 })).toThrow();
    expect(() => taxiFare("economy", 5, { extraMinutes: 125 })).toThrow();
  });

  it("does not add weather or traffic charges", () => {
    const fare = calculateFareBreakdown("luxury", 5, {
      weather: "heat",
      roadCondition: "congested",
    });
    expect(fare.weatherAllowance).toBe(0);
    expect(fare.trafficAllowance).toBe(0);
  });

  it("enforces the 1,000 IQD minimum for ordinary taxi categories and rejects invalid distances", () => {
    expect(taxiFare("economy", 0)).toBe(1000);
    expect(taxiFare("premium", 0)).toBe(1250);
    expect(taxiFare("luxury", 0)).toBe(1500);
    expect(taxiFare("economy", 0.625)).toBe(1000);
    expect(taxiFare("large", 0)).toBe(0);
    expect(() => taxiFare("economy", NaN)).toThrow();
  });
});
