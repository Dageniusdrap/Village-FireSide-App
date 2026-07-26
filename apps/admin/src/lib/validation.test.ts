import { describe, expect, it } from "vitest";

import { emailSchema, passwordSchema, signInSchema } from "./validation";

describe("emailSchema", () => {
  it("accepts a valid email", () => {
    expect(emailSchema.safeParse("a@b.com").success).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(emailSchema.safeParse("").success).toBe(false);
  });
});

describe("passwordSchema", () => {
  it("accepts an 8-character password", () => {
    expect(passwordSchema.safeParse("12345678").success).toBe(true);
  });

  it("rejects a 7-character password", () => {
    expect(passwordSchema.safeParse("1234567").success).toBe(false);
  });
});

describe("signInSchema", () => {
  it("accepts a valid email and password", () => {
    expect(signInSchema.safeParse({ email: "a@b.com", password: "12345678" }).success).toBe(true);
  });

  it("rejects a missing email", () => {
    expect(signInSchema.safeParse({ email: "", password: "12345678" }).success).toBe(false);
  });
});
