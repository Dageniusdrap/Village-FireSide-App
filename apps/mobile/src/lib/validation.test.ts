import {
  emailSchema,
  forgotPasswordSchema,
  localPhoneNumberSchema,
  otpVerifySchema,
  passwordSchema,
  phoneSignInSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "./validation";

describe("emailSchema", () => {
  it("accepts a valid email", () => {
    expect(emailSchema.safeParse("a@b.com").success).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(emailSchema.safeParse("").success).toBe(false);
  });

  it("rejects a string with no @", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
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

describe("localPhoneNumberSchema", () => {
  it("accepts 7-15 digits", () => {
    expect(localPhoneNumberSchema.safeParse("712345678").success).toBe(true);
  });

  it("rejects non-digit characters", () => {
    expect(localPhoneNumberSchema.safeParse("712-345").success).toBe(false);
  });

  it("rejects fewer than 7 digits", () => {
    expect(localPhoneNumberSchema.safeParse("12345").success).toBe(false);
  });
});

describe("otpVerifySchema", () => {
  it("accepts a 6-digit code", () => {
    expect(otpVerifySchema.safeParse({ code: "123456" }).success).toBe(true);
  });

  it("rejects a 5-digit code", () => {
    expect(otpVerifySchema.safeParse({ code: "12345" }).success).toBe(false);
  });

  it("rejects a non-numeric code", () => {
    expect(otpVerifySchema.safeParse({ code: "abcdef" }).success).toBe(false);
  });
});

describe("signInSchema", () => {
  it("accepts a valid email and password", () => {
    expect(signInSchema.safeParse({ email: "a@b.com", password: "12345678" }).success).toBe(true);
  });

  it("rejects a missing password", () => {
    expect(signInSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});

describe("signUpSchema", () => {
  it("accepts an optional display name", () => {
    const result = signUpSchema.safeParse({ email: "a@b.com", password: "12345678" });
    expect(result.success).toBe(true);
  });

  it("accepts a provided display name", () => {
    const result = signUpSchema.safeParse({
      email: "a@b.com",
      password: "12345678",
      displayName: "Amina",
    });
    expect(result.success).toBe(true);
  });
});

describe("phoneSignInSchema", () => {
  it("accepts a dial code and local number", () => {
    expect(
      phoneSignInSchema.safeParse({ dialCode: "+254", localNumber: "712345678" }).success,
    ).toBe(true);
  });
});

describe("forgotPasswordSchema", () => {
  it("accepts a valid email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
  });
});

describe("resetPasswordSchema", () => {
  it("accepts an 8-character password", () => {
    expect(resetPasswordSchema.safeParse({ password: "12345678" }).success).toBe(true);
  });
});
