export type ContentSource =
  "elder_testimony" | "narrated_production" | "ai_assisted" | "tour_guide_original";

export type AccessTier = "free" | "coins" | "premium";

export type Episode = {
  id: string;
  title: string;
  durationSeconds: number | null;
  accessTier: AccessTier;
  contentSource: ContentSource;
};

export type Series = {
  id: string;
  title: string;
  coverImageUrl: string | null;
  category: string | null;
  episodeCount: number;
};

export type Destination = {
  id: string;
  name: string;
  region: string | null;
  coverImageUrl: string | null;
};
