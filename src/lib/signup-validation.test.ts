import { describe, it, expect } from "vitest";
import { signupSchema, requiresEmailConfirmation } from "./signup-validation";

const valid = { name: "علي شاكر", phone: "07701234567", email: "ali@example.com", password: "a-long-test-password" };

describe("registration email requirements", () => {
  it("allows registration without an email", () => {
    const result = signupSchema.safeParse({ ...valid, email: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("");
  });
  it("rejects malformed email", () => {
    expect(signupSchema.safeParse({ ...valid, email: "ali" }).success).toBe(false);
  });
  it("uses the real normalized email", () => {
    expect(signupSchema.parse({ ...valid, email: " Ali@Example.com " }).email).toBe("ali@example.com");
  });
  it("does not consider an unconfirmed signup signed in", () => {
    expect(requiresEmailConfirmation(null)).toBe(true);
    expect(requiresEmailConfirmation({ user: { id: "confirmed-user" } })).toBe(false);
  });
});