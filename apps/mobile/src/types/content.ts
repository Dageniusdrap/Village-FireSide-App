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
  slug: string;
  region: string | null;
  district: string | null;
  country: string | null;
  coverImageUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  categories: string[];
};

export type ContributorType =
  "elder" | "voice_artist" | "writer" | "tour_guide" | "historian" | "translator";

export type CulturalGroup = {
  id: string;
  name: string;
  description: string | null;
  country: string | null;
  region: string | null;
  coverImageUrl: string | null;
};

export type PublicContributor = {
  id: string;
  displayName: string;
  contributorType: ContributorType;
  bio: string | null;
  photoUrl: string | null;
  district: string | null;
  country: string | null;
};
