import type { Destination, Episode, Series } from "@/types/content";

export const mockEpisodes: Episode[] = [
  {
    id: "ep-1",
    title: "The Lake That Remembers",
    durationSeconds: 642,
    accessTier: "free",
    contentSource: "elder_testimony",
  },
  {
    id: "ep-2",
    title: "How the Baobab Got Its Shape",
    durationSeconds: 518,
    accessTier: "coins",
    contentSource: "narrated_production",
  },
  {
    id: "ep-3",
    title: "The Drummer of Kabale Hills",
    durationSeconds: 731,
    accessTier: "premium",
    contentSource: "ai_assisted",
  },
];

export const mockSeries: Series[] = [
  {
    id: "series-1",
    title: "Lakeside Legends",
    coverImageUrl: "https://placehold.co/400x400?text=Lakeside+Legends",
    category: "lakes",
    episodeCount: 8,
  },
  {
    id: "series-2",
    title: "Elder History",
    coverImageUrl: "https://placehold.co/400x400?text=Elder+History",
    category: "elder_history",
    episodeCount: 12,
  },
  {
    id: "series-3",
    title: "Hidden Africa",
    coverImageUrl: "https://placehold.co/400x400?text=Hidden+Africa",
    category: "hidden_africa",
    episodeCount: 5,
  },
];

export const mockDestinations: Destination[] = [
  {
    id: "dest-1",
    name: "Lake Bunyonyi",
    region: "Kigezi",
    coverImageUrl: "https://placehold.co/400x300?text=Lake+Bunyonyi",
  },
  {
    id: "dest-2",
    name: "Sipi Falls",
    region: "Mount Elgon",
    coverImageUrl: "https://placehold.co/400x300?text=Sipi+Falls",
  },
  {
    id: "dest-3",
    name: "Kibale Forest",
    region: "Western Region",
    coverImageUrl: "https://placehold.co/400x300?text=Kibale+Forest",
  },
];
