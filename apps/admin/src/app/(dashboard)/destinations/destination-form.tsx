// apps/admin/src/app/(dashboard)/destinations/destination-form.tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";

import { Button } from "@/components/button";
import { Textarea } from "@/components/textarea";
import { TextInput } from "@/components/text-input";
import { Toggle } from "@/components/toggle";
import { createClient } from "@/lib/supabase/client";
import { slugify } from "@/lib/slugify";
import { type DestinationInput, destinationSchema } from "@/lib/validation";

import { createDestination, updateDestination } from "./actions";
import { MapPicker } from "./map-picker";

export type DestinationRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  region: string | null;
  district: string | null;
  country: string | null;
  best_time_to_visit: string | null;
  entry_fee_notes: string | null;
  safety_notes: string | null;
  conservation_notes: string | null;
  cover_image_url: string | null;
  latitude: number | null;
  longitude: number | null;
  is_published: boolean;
};

export function DestinationForm({ destination }: { destination?: DestinationRow }) {
  const router = useRouter();
  const [apiError, setApiError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const slugTouchedRef = useRef(destination ? true : false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<DestinationInput>({
    // zodResolver infers its Input generic as the schema's pre-coercion type
    // (latitude/longitude as `unknown` under z.coerce.number()), which
    // mismatches the post-coercion `DestinationInput` type useForm expects.
    // The cast just aligns the resolver's declared type with the actual
    // Resolver shape useForm expects; the runtime behavior is unaffected.
    resolver: zodResolver(destinationSchema) as Resolver<DestinationInput>,
    defaultValues: {
      name: destination?.name ?? "",
      slug: destination?.slug ?? "",
      description: destination?.description ?? "",
      region: destination?.region ?? "",
      district: destination?.district ?? "",
      country: destination?.country ?? "",
      bestTimeToVisit: destination?.best_time_to_visit ?? "",
      entryFeeNotes: destination?.entry_fee_notes ?? "",
      safetyNotes: destination?.safety_notes ?? "",
      conservationNotes: destination?.conservation_notes ?? "",
      coverImageUrl: destination?.cover_image_url ?? "",
      latitude: destination?.latitude ?? undefined,
      longitude: destination?.longitude ?? undefined,
      isPublished: destination?.is_published ?? false,
    },
  });

  const name = watch("name");
  const latitude = watch("latitude");
  const longitude = watch("longitude");

  const handleNameChange = (value: string) => {
    setValue("name", value);
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
    const path = `destinations/${crypto.randomUUID()}-${file.name}`;
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

  const onSubmit = async (values: DestinationInput) => {
    setApiError(undefined);
    // Handled as separate branches (rather than a ternary feeding a single
    // `result`) so TypeScript narrows each call's return type on its own —
    // createDestination's `ActionResult & { id?: string }` and
    // updateDestination's plain `ActionResult` don't unify cleanly through a
    // shared `result` binding, which breaks the `result.id` access below.
    if (destination) {
      const result = await updateDestination(destination.id, values);
      if (!result.ok) {
        setApiError(result.message);
        return;
      }
      router.push("/destinations");
      return;
    }

    const result = await createDestination(values);
    if (!result.ok) {
      setApiError(result.message);
      return;
    }
    router.push(`/destinations/${result.id}/edit`);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-lg flex-col gap-3">
      <label className="flex flex-col gap-1">
        Name
        <TextInput
          {...register("name")}
          onChange={(e) => handleNameChange(e.target.value)}
          value={name}
        />
        {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
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
        Region
        <TextInput {...register("region")} />
      </label>

      <label className="flex flex-col gap-1">
        District
        <TextInput {...register("district")} />
      </label>

      <label className="flex flex-col gap-1">
        Country
        <TextInput {...register("country")} />
      </label>

      <label className="flex flex-col gap-1">
        Best Time to Visit
        <Textarea {...register("bestTimeToVisit")} rows={2} />
      </label>

      <label className="flex flex-col gap-1">
        Entry Fee Notes
        <Textarea {...register("entryFeeNotes")} rows={2} />
      </label>

      <label className="flex flex-col gap-1">
        Safety Notes
        <Textarea {...register("safetyNotes")} rows={2} />
      </label>

      <label className="flex flex-col gap-1">
        Conservation Notes
        <Textarea {...register("conservationNotes")} rows={2} />
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

      <div className="flex flex-col gap-1">
        <span>Location</span>
        <MapPicker
          latitude={latitude}
          longitude={longitude}
          onChange={(lat, lng) => {
            setValue("latitude", lat);
            setValue("longitude", lng);
          }}
        />
      </div>

      <Toggle label="Published" {...register("isPublished")} />

      {apiError && <p className="text-sm text-red-600">{apiError}</p>}

      <Button type="submit" disabled={isSubmitting || uploading}>
        {isSubmitting ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
