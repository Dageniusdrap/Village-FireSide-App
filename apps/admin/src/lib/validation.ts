import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Enter a valid email address");

export const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

export const signInSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type SignInInput = z.infer<typeof signInSchema>;

export const seriesSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  slug: z.string().trim().min(1, "Slug is required"),
  description: z.string().trim().optional(),
  category: z.string().trim().optional(),
  destinationId: z.string().uuid().optional().or(z.literal("")),
  coverImageUrl: z.string().optional(),
  isFeatured: z.boolean(),
  isPublished: z.boolean(),
});
export type SeriesInput = z.infer<typeof seriesSchema>;
