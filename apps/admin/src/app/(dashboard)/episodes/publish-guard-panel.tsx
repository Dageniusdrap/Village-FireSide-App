// apps/admin/src/app/(dashboard)/episodes/publish-guard-panel.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/button";

import type { PublishCheck } from "./check-publish-requirements";
import { publishEpisode, unpublishEpisode, validateEpisodeForPublish } from "./publish-actions";

export function PublishGuardPanel({ episodeId, status }: { episodeId: string; status: string }) {
  const router = useRouter();
  const [checks, setChecks] = useState<PublishCheck[] | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>();

  const handleCheck = async () => {
    setIsChecking(true);
    setApiError(undefined);
    const result = await validateEpisodeForPublish(episodeId);
    setChecks(result);
    setIsChecking(false);
  };

  const handleConfirmPublish = async () => {
    setIsPublishing(true);
    setApiError(undefined);
    const result = await publishEpisode(episodeId);
    setIsPublishing(false);
    if (!result.ok) {
      setApiError(result.message);
      return;
    }
    router.refresh();
    setChecks(null);
  };

  const handleUnpublish = async () => {
    setApiError(undefined);
    const result = await unpublishEpisode(episodeId);
    if (!result.ok) {
      setApiError(result.message);
      return;
    }
    router.refresh();
  };

  if (status === "published") {
    return (
      <div className="flex flex-col gap-2 rounded border border-gray-200 p-4">
        <p className="font-medium">This episode is published.</p>
        <Button variant="secondary" onClick={() => void handleUnpublish()}>
          Unpublish
        </Button>
        {apiError && <p className="text-sm text-red-600">{apiError}</p>}
      </div>
    );
  }

  const allPassed = checks !== null && checks.every((check) => check.passed);

  return (
    <div className="flex flex-col gap-3 rounded border border-gray-200 p-4">
      <Button variant="secondary" onClick={() => void handleCheck()} disabled={isChecking}>
        {isChecking ? "Checking…" : "Check Publish Requirements"}
      </Button>

      {checks && (
        <ul className="flex flex-col gap-1">
          {checks.map((check) => (
            <li key={check.label} className={check.passed ? "text-green-700" : "text-red-700"}>
              {check.passed ? "✓" : "✗"} {check.label}
              {!check.passed && check.reason && (
                <span className="block text-sm text-gray-600">{check.reason}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {allPassed && (
        <Button onClick={() => void handleConfirmPublish()} disabled={isPublishing}>
          {isPublishing ? "Publishing…" : "Confirm Publish"}
        </Button>
      )}

      {apiError && <p className="text-sm text-red-600">{apiError}</p>}
    </div>
  );
}
