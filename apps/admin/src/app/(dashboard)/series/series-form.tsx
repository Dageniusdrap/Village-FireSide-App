// apps/admin/src/app/(dashboard)/series/series-form.tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/button";
import { Select } from "@/components/select";
import { Textarea } from "@/components/textarea";
import { TextInput } from "@/components/text-input";
import { Toggle } from "@/components/toggle";
import { createClient } from "@/lib/supabase/client";
import { slugify } from "@/lib/slugify";
import { type SeriesInput, seriesSchema } from "@/lib/validation";

import { createSeries, updateSeries } from "./actions";

export type SeriesRow = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  category: string | null;
  destination_id: string | null;
  cover_image_url: string | null;
  is_featured: boolean;
  is_published: boolean;
};

export type DestinationOption = { id: string; name: string };

export function SeriesForm({
  series,
  destinations,
}: {
  series?: SeriesRow;
  destinations: DestinationOption[];
}) {
  const router = useRouter();
  const [apiError, setApiError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const slugTouchedRef = useRef(series ? true : false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SeriesInput>({
    resolver: zodResolver(seriesSchema),
    defaultValues: {
      title: series?.title ?? "",
      slug: series?.slug ?? "",
      description: series?.description ?? "",
      category: series?.category ?? "",
      destinationId: series?.destination_id ?? "",
      coverImageUrl: series?.cover_image_url ?? "",
      isFeatured: series?.is_featured ?? false,
      isPublished: series?.is_published ?? false,
    },
  });

  const title = watch("title");

  const handleTitleChange = (value: string) => {
    setValue("title", value);
    if (!slugTouchedRef.current) {
      setValue("slug", slugify(value));
    }
  };

  const handleSlugChange = (value: string) => {
    slugTouchedRef.current = true;
    setValue("slug", value);
  };

  const handleCoverUpload = async (file: File) => {
    setUploading(true);
    setApiError(undefined);
    const supabase = createClient();
    const path = `series/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("images").upload(path, file);
    if (uploadError) {
      setApiError(uploadError.message);
      setUploading(false);
      return;
    }
    const { data } = supabase.storage.from("images").getPublicUrl(path);
    setValue("coverImageUrl", data.publicUrl);
    setUploading(false);
  };

  const onSubmit = async (values: SeriesInput) => {
    setApiError(undefined);
    const result = series ? await updateSeries(series.id, values) : await createSeries(values);
    if (!result.ok) {
      setApiError(result.message);
      return;
    }
    router.push("/series");
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-lg flex-col gap-3">
      <label className="flex flex-col gap-1">
        Title
        <TextInput
          {...register("title")}
          onChange={(e) => handleTitleChange(e.target.value)}
          value={title}
        />
        {errors.title && <p className="text-sm text-red-600">{errors.title.message}</p>}
      </label>

      <label className="flex flex-col gap-1">
        Slug
        <TextInput {...register("slug")} onChange={(e) => handleSlugChange(e.target.value)} />
        {errors.slug && <p className="text-sm text-red-600">{errors.slug.message}</p>}
      </label>

      <label className="flex flex-col gap-1">
        Description
        <Textarea {...register("description")} rows={3} />
      </label>

      <label className="flex flex-col gap-1">
        Category
        <TextInput {...register("category")} placeholder="e.g. lakes, forests, elder_history" />
      </label>

      <label className="flex flex-col gap-1">
        Destination
        <Select {...register("destinationId")}>
          <option value="">None</option>
          {destinations.map((destination) => (
            <option key={destination.id} value={destination.id}>
              {destination.name}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1">
        Cover Image
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void handleCoverUpload(file);
            }
          }}
        />
        {uploading && <p className="text-sm text-gray-500">Uploading…</p>}
      </label>

      <Toggle label="Featured" {...register("isFeatured")} />
      <Toggle label="Published" {...register("isPublished")} />

      {apiError && <p className="text-sm text-red-600">{apiError}</p>}

      <Button type="submit" disabled={isSubmitting || uploading}>
        {isSubmitting ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
