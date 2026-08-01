import {
  bookingInquirySchema,
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

describe("bookingInquirySchema", () => {
  const valid = {
    name: "Amina Nakato",
    phone: "0772123456",
    email: "amina@example.com",
    preferredDate: "2026-08-15",
    message: "We'd like a 3-day trip for a family of four.",
  };

  it("accepts a fully filled valid inquiry", () => {
    expect(bookingInquirySchema.safeParse(valid).success).toBe(true);
  });

  it("accepts email and preferredDate omitted", () => {
    const { email: _email, preferredDate: _preferredDate, ...rest } = valid;
    expect(bookingInquirySchema.safeParse(rest).success).toBe(true);
  });

  it("rejects a missing name", () => {
    const result = bookingInquirySchema.safeParse({ ...valid, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing phone", () => {
    const result = bookingInquirySchema.safeParse({ ...valid, phone: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing message", () => {
    const result = bookingInquirySchema.safeParse({ ...valid, message: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed email", () => {
    const result = bookingInquirySchema.safeParse({ ...valid, email: "not-an-email" });
    expect(result.success).toBe(false);
  });
});
