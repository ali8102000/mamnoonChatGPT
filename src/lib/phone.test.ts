import { describe, expect, it } from "vitest";
import { isValidPhone, normalizePhone, phoneToEmail } from "./phone";

describe("Iraqi phone identity normalization", () => {
  it("normalizes local Iraqi mobile numbers to E.164", () => {
    expect(normalizePhone("0770 123 4567")).toBe("+9647701234567");
  });

  it("preserves an already international Iraqi number", () => {
    expect(normalizePhone("+964 770 123 4567")).toBe("+9647701234567");
  });

  it("uses the same deterministic auth alias for the normalized phone", () => {
    expect(phoneToEmail("0770 123 4567")).toBe("phone9647701234567@mamnoon.app");
  });

  it("rejects malformed phone numbers", () => {
    expect(isValidPhone("not-a-phone")).toBe(false);
    expect(isValidPhone("07701234567")).toBe(true);
  });
});
