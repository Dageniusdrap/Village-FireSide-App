// apps/admin/src/app/(dashboard)/episodes/new/page.tsx
import { EpisodeForm } from "../episode-form";
import { loadEpisodeFormOptions } from "../load-episode-form-options";

export default async function NewEpisodePage() {
  const { seriesOptions, sourceMaterialOptions, contributorOptions } =
    await loadEpisodeFormOptions();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">New Episode</h1>
      <EpisodeForm
        seriesOptions={seriesOptions}
        sourceMaterialOptions={sourceMaterialOptions}
        contributorOptions={contributorOptions}
        existingLinks={[]}
      />
    </div>
  );
}
