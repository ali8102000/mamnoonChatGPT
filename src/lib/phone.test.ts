import { describe, expect, it } from "vitest";
import { normalizePhone, phoneToEmail } from "./phone";

describe("Iraqi phone normalization", () => {
  it.each(["07701234567", "7701234567", "9647701234567", "+9647701234567"])(
    "normalizes %s to the same canonical number",
    (value) => {
      expect(normalizePhone(value)).toBe("+9647701234567");
    },
  );

  it("creates the same legacy email regardless of input format", () => {
    const expected = "phone9647701234567@mamnoon.app";
    expect(phoneToEmail("07701234567")).toBe(expected);
    expect(phoneToEmail("+9647701234567")).toBe(expected);
  });
});
