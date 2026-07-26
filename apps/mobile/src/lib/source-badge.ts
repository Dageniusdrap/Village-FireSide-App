import type { ContentSource } from "@/types/content";

export type SourceBadgeContent = {
  label: string;
  variant: "gold" | "neutral";
};

export function getSourceBadgeContent(source: ContentSource): SourceBadgeContent {
  if (source === "elder_testimony") {
    return { label: "Elder testimony", variant: "gold" };
  }
  return { label: "Narrated production", variant: "neutral" };
}
