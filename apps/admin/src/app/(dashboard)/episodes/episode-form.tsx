// apps/admin/src/app/(dashboard)/episodes/episode-form.tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";

import { Button } from "@/components/button";
import { Select } from "@/components/select";
import { Textarea } from "@/components/textarea";
import { TextInput } from "@/components/text-input";
import { createClient } from "@/lib/supabase/client";
import { type EpisodeInput, episodeSchema } from "@/lib/validation";

import { createEpisode, type ContributorLink, updateEpisode } from "./actions";
import { ContributorLinker, type ContributorOption } from "./contributor-linker";

export type EpisodeRow = {
  id: string;
  series_id: string;
  episode_number: number;
  title: string;
  description: string | null;
  language: string;
  access_tier: string;
  coin_price: number;
  content_source: string;
  subject_area: string | null;
  grade_level: string | null;
  syllabus_topic: string | null;
  source_material_id: string | null;
  audio_url: string | null;
  duration_seconds: number | null;
};

export type SeriesOption = { id: string; title: string };
export type SourceMaterialOption = { id: string; title: string; public_domain_verified: boolean };

export function EpisodeForm({
  episode,
  seriesOptions,
  sourceMaterialOptions,
  contributorOptions,
  existingLinks,
}: {
  episode?: EpisodeRow;
  seriesOptions: SeriesOption[];
  sourceMaterialOptions: SourceMaterialOption[];
  contributorOptions: ContributorOption[];
  existingLinks: ContributorLink[];
}) {
  const router = useRouter();
  const [apiError, setApiError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const [links, setLinks] = useState<ContributorLink[]>(existingLinks);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<EpisodeInput>({
    // zodResolver infers its Input generic as the schema's pre-coercion type
    // (`unknown` for the z.coerce.number() fields), which doesn't structurally
    // match EpisodeInput (the post-coercion, numeric output type). Cast to the
    // Resolver shape useForm expects; the runtime behavior is unaffected.
    resolver: zodResolver(episodeSchema) as Resolver<EpisodeInput>,
    defaultValues: {
      seriesId: episode?.series_id ?? "",
      episodeNumber: episode?.episode_number ?? 1,
      title: episode?.title ?? "",
      description: episode?.description ?? "",
      language: (episode?.language as EpisodeInput["language"]) ?? "en",
      accessTier: (episode?.access_tier as EpisodeInput["accessTier"]) ?? "free",
      coinPrice: episode?.coin_price ?? 0,
      contentSource:
        (episode?.content_source as EpisodeInput["contentSource"]) ?? "narrated_production",
      subjectArea: (episode?.subject_area as EpisodeInput["subjectArea"]) ?? "",
      gradeLevel: (episode?.grade_level as EpisodeInput["gradeLevel"]) ?? "",
      syllabusTopic: episode?.syllabus_topic ?? "",
      sourceMaterialId: episode?.source_material_id ?? "",
      audioUrl: episode?.audio_url ?? "",
      durationSeconds: episode?.duration_seconds ?? undefined,
    },
  });

  const accessTier = watch("accessTier");
  const sourceMaterialId = watch("sourceMaterialId");
  const selectedSourceMaterial = sourceMaterialOptions.find((sm) => sm.id === sourceMaterialId);

  const handleAudioUpload = async (file: File) => {
    setUploading(true);
    setApiError(undefined);

    // Read duration client-side via a temporary <audio> element before
    // uploading — no server-side audio-processing library needed.
    const duration = await new Promise<number>((resolve, reject) => {
      const audio = new Audio();
      audio.preload = "metadata";
      audio.onloadedmetadata = () => resolve(Math.round(audio.duration));
      audio.onerror = () => reject(new Error("Could not read audio file metadata."));
      audio.src = URL.createObjectURL(file);
    }).catch((err: Error) => {
      setApiError(err.message);
      return null;
    });

    if (duration === null) {
      setUploading(false);
      return;
    }

    const supabase = createClient();
    const path = `episodes/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("audio-episodes").upload(path, file);
    if (uploadError) {
      setApiError(uploadError.message);
      setUploading(false);
      return;
    }
    // audio-episodes is a private bucket — episodes.audio_url stores the
    // bucket-relative object path, not a public URL. Playback goes through
    // the get-episode-audio Edge Function's createSignedUrl(audio_url, ...),
    // which treats this field as the storage key itself (see
    // docs/media-pipeline.md). Do NOT call getPublicUrl() here.
    setValue("audioUrl", path);
    setValue("durationSeconds", duration);
    setUploading(false);
  };

  const onSubmit = async (values: EpisodeInput) => {
    setApiError(undefined);
    const result = episode
      ? await updateEpisode(episode.id, values, links)
      : await createEpisode(values, links);
    if (!result.ok) {
      setApiError(result.message);
      return;
    }
    router.push("/episodes");
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-lg flex-col gap-3">
      <label className="flex flex-col gap-1">
        Series
        <Select {...register("seriesId")}>
          <option value="">Select a series</option>
          {seriesOptions.map((series) => (
            <option key={series.id} value={series.id}>
              {series.title}
            </option>
          ))}
        </Select>
        {errors.seriesId && <p className="text-sm text-red-600">{errors.seriesId.message}</p>}
      </label>

      <label className="flex flex-col gap-1">
        Episode Number
        <TextInput type="number" {...register("episodeNumber")} />
        {errors.episodeNumber && (
          <p className="text-sm text-red-600">{errors.episodeNumber.message}</p>
        )}
      </label>

      <label className="flex flex-col gap-1">
        Title
        <TextInput {...register("title")} />
        {errors.title && <p className="text-sm text-red-600">{errors.title.message}</p>}
      </label>

      <label className="flex flex-col gap-1">
        Description
        <Textarea {...register("description")} rows={3} />
      </label>

      <label className="flex flex-col gap-1">
        Language
        <Select {...register("language")}>
          <option value="en">English</option>
          <option value="lg">Luganda</option>
          <option value="sw">Swahili</option>
          <option value="fr">French</option>
          <option value="rw">Kinyarwanda</option>
        </Select>
      </label>

      <label className="flex flex-col gap-1">
        Access Tier
        <Select {...register("accessTier")}>
          <option value="free">Free</option>
          <option value="coins">Coins</option>
          <option value="premium">Premium</option>
        </Select>
      </label>

      {accessTier === "coins" && (
        <label className="flex flex-col gap-1">
          Coin Price
          <TextInput type="number" {...register("coinPrice")} />
        </label>
      )}

      <label className="flex flex-col gap-1">
        Content Source
        <Select {...register("contentSource")}>
          <option value="narrated_production">Narrated Production</option>
          <option value="elder_testimony">Elder Testimony</option>
          <option value="ai_assisted">AI Assisted</option>
          <option value="tour_guide_original">Tour Guide Original</option>
        </Select>
      </label>

      <label className="flex flex-col gap-1">
        Subject Area
        <Select {...register("subjectArea")}>
          <option value="">None</option>
          <option value="history">History</option>
          <option value="biology">Biology</option>
          <option value="geography">Geography</option>
          <option value="culture">Culture</option>
          <option value="conservation">Conservation</option>
          <option value="folklore">Folklore</option>
        </Select>
      </label>

      <label className="flex flex-col gap-1">
        Grade Level
        <Select {...register("gradeLevel")}>
          <option value="">None</option>
          <option value="primary">Primary</option>
          <option value="o_level">O-Level</option>
          <option value="a_level">A-Level</option>
          <option value="tertiary">Tertiary</option>
          <option value="general">General</option>
        </Select>
      </label>

      <label className="flex flex-col gap-1">
        Syllabus Topic
        <TextInput {...register("syllabusTopic")} />
      </label>

      <label className="flex flex-col gap-1">
        Source Material
        <Select {...register("sourceMaterialId")}>
          <option value="">None</option>
          {sourceMaterialOptions.map((sm) => (
            <option key={sm.id} value={sm.id}>
              {sm.title}
            </option>
          ))}
        </Select>
        {selectedSourceMaterial && !selectedSourceMaterial.public_domain_verified && (
          <p className="text-sm text-amber-700">This source material is not yet verified.</p>
        )}
      </label>

      <label className="flex flex-col gap-1">
        Audio File
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void handleAudioUpload(file);
            }
          }}
        />
        {uploading && <p className="text-sm text-gray-500">Uploading…</p>}
      </label>

      <ContributorLinker options={contributorOptions} links={links} onChange={setLinks} />

      {apiError && <p className="text-sm text-red-600">{apiError}</p>}

      <Button type="submit" disabled={isSubmitting || uploading}>
        {isSubmitting ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
