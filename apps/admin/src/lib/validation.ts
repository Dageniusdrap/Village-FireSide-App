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

export const episodeSchema = z.object({
  seriesId: z.string().uuid("Select a series"),
  episodeNumber: z.coerce.number().int().positive("Episode number must be a positive integer"),
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().optional(),
  language: z.enum(["en", "lg", "sw", "fr", "rw"]),
  accessTier: z.enum(["free", "coins", "premium"]),
  coinPrice: z.coerce.number().int().min(0).default(0),
  contentSource: z.enum([
    "elder_testimony",
    "narrated_production",
    "ai_assisted",
    "tour_guide_original",
  ]),
  subjectArea: z
    .enum(["history", "biology", "geography", "culture", "conservation", "folklore"])
    .optional()
    .or(z.literal("")),
  gradeLevel: z
    .enum(["primary", "o_level", "a_level", "tertiary", "general"])
    .optional()
    .or(z.literal("")),
  syllabusTopic: z.string().trim().optional(),
  sourceMaterialId: z.string().uuid().optional().or(z.literal("")),
  audioUrl: z.string().optional(),
  durationSeconds: z.coerce.number().int().positive().optional(),
});
export type EpisodeInput = z.infer<typeof episodeSchema>;

export const destinationSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  slug: z.string().trim().min(1, "Slug is required"),
  description: z.string().trim().optional(),
  region: z.string().trim().optional(),
  district: z.string().trim().optional(),
  country: z.string().trim().optional(),
  bestTimeToVisit: z.string().trim().optional(),
  entryFeeNotes: z.string().trim().optional(),
  safetyNotes: z.string().trim().optional(),
  conservationNotes: z.string().trim().optional(),
  coverImageUrl: z.string().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  isPublished: z.boolean(),
});
export type DestinationInput = z.infer<typeof destinationSchema>;
