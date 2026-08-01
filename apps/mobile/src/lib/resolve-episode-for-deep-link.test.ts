import { supabase } from "@/lib/supabase";

import { resolveEpisodeForDeepLink } from "./resolve-episode-for-deep-link";

jest.mock("@/lib/supabase", () => ({
  supabase: { from: jest.fn() },
}));

function mockSingleResult(data: unknown, error: unknown = null) {
  const returns = jest.fn().mockResolvedValue({ data, error });
  const single = jest.fn().mockReturnValue({ returns });
  const eq = jest.fn().mockReturnValue({ single });
  const select = jest.fn().mockReturnValue({ eq });
  (supabase.from as jest.Mock).mockReturnValue({ select });
}

describe("resolveEpisodeForDeepLink", () => {
  it("builds a QueueEpisode when the episode resolves", async () => {
    mockSingleResult({
      id: "ep-1",
      title: "The Fisherman's Tale",
      episode_number: 3,
      duration_seconds: 500,
      access_tier: "free",
      coin_price: 0,
      content_source: "elder_testimony",
      series_id: "series-1",
      series: { title: "Lake Bunyonyi Stories", cover_image_url: "https://example.com/cover.jpg" },
    });

    const result = await resolveEpisodeForDeepLink("ep-1");

    expect(result).toEqual({
      id: "ep-1",
      title: "The Fisherman's Tale",
      episodeNumber: 3,
      durationSeconds: 500,
      accessTier: "free",
      coinPrice: 0,
      contentSource: "elder_testimony",
      resumePositionSeconds: null,
      seriesId: "series-1",
      seriesTitle: "Lake Bunyonyi Stories",
      coverImageUrl: "https://example.com/cover.jpg",
    });
  });

  it("returns null when the episode isn't found or isn't accessible", async () => {
    mockSingleResult(null, { message: "not found" });

    expect(await resolveEpisodeForDeepLink("missing")).toBeNull();
  });
});
