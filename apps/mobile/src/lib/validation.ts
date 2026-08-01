import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Enter a valid email address");

export const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

export const otpSchema = z.string().regex(/^\d{6}$/, "Enter the 6-digit code");

export const localPhoneNumberSchema = z.string().regex(/^\d{7,15}$/, "Enter a valid phone number");

export const signInSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type SignInInput = z.infer<typeof signInSchema>;

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().max(60).optional(),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const phoneSignInSchema = z.object({
  dialCode: z.string().regex(/^\+\d+$/, "Select a country"),
  localNumber: localPhoneNumberSchema,
});
export type PhoneSignInInput = z.infer<typeof phoneSignInSchema>;

export const otpVerifySchema = z.object({
  code: otpSchema,
});
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const bookingInquirySchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  phone: z.string().trim().min(1, "Phone number is required"),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  preferredDate: z.string().optional(),
  message: z.string().trim().min(1, "Tell us a bit about your trip"),
});
export type BookingInquiryInput = z.infer<typeof bookingInquirySchema>;
