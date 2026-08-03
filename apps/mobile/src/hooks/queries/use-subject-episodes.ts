// apps/mobile/src/hooks/queries/use-subject-episodes.ts
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import type { Episode, SubjectArea } from "@/types/content";

export type SubjectEpisode = Episode & {
  seriesId: string;
  seriesTitle: string;
  coverImageUrl: string | null;
  culturalGroupIds: string[];
};

type EpisodeRow = {
  id: string;
  title: string;
  duration_seconds: number | null;
  access_tier: Episode["accessTier"];
  content_source: Episode["contentSource"];
  subject_area: Episode["subjectArea"];
  grade_level: Episode["gradeLevel"];
  syllabus_topic: string | null;
  series_id: string;
  // Null when the linked series is currently hidden from this user by its
  // own RLS policy (series_select_published gates independently of
  // episodes_select_published) — mirrors use-bookmarks.ts's and
  // use-contributor-detail.ts's nested-embed nullability pattern.
  series: {
    title: string;
    cover_image_url: string | null;
    series_cultural_groups: { cultural_group_id: string }[];
  } | null;
};

export function useSubjectEpisodes(subject: SubjectArea) {
  return useQuery({
    queryKey: ["learn", "subject-episodes", subject],
    queryFn: async (): Promise<SubjectEpisode[]> => {
      // No explicit `.eq("status", "published")` here — episodes_select_published
      // RLS already restricts this table to published rows, same reliance
      // use-destinations.ts documents for series' own RLS.
      const { data, error } = await supabase
        .from("episodes")
        .select(
          "id, title, duration_seconds, access_tier, content_source, subject_area, grade_level, syllabus_topic, series_id, series(title, cover_image_url, series_cultural_groups(cultural_group_id))",
        )
        .eq("subject_area", subject)
        .order("title", { ascending: true })
        .returns<EpisodeRow[]>();
      if (error) {
        throw error;
      }
      return data
        .filter(
          (row): row is EpisodeRow & { series: NonNullable<EpisodeRow["series"]> } =>
            row.series !== null,
        )
        .map((row) => ({
          id: row.id,
          title: row.title,
          durationSeconds: row.duration_seconds,
          accessTier: row.access_tier,
          contentSource: row.content_source,
          subjectArea: row.subject_area,
          gradeLevel: row.grade_level,
          syllabusTopic: row.syllabus_topic,
          seriesId: row.series_id,
          seriesTitle: row.series.title,
          coverImageUrl: row.series.cover_image_url,
          culturalGroupIds: row.series.series_cultural_groups.map((g) => g.cultural_group_id),
        }));
    },
  });
}
