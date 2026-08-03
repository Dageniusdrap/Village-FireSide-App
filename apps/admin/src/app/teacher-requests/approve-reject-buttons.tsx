"use client";

import { useState } from "react";

import { approveTeacherRequest, rejectTeacherRequest } from "./actions";

export function ApproveRejectButtons({ requestId, userId }: { requestId: string; userId: string }) {
  const [isPending, setIsPending] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>();

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <button
          disabled={isPending}
          className="rounded bg-[#1F3B2C] px-2 py-1 text-sm text-white disabled:opacity-50"
          onClick={async () => {
            setApiError(undefined);
            setIsPending(true);
            try {
              const result = await approveTeacherRequest(requestId, userId);
              if (!result.ok) {
                setApiError(result.message);
              }
            } catch {
              setApiError("Failed to approve request.");
            } finally {
              setIsPending(false);
            }
          }}
        >
          Approve
        </button>
        <button
          disabled={isPending}
          className="rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-50"
          onClick={async () => {
            setApiError(undefined);
            setIsPending(true);
            try {
              const result = await rejectTeacherRequest(requestId);
              if (!result.ok) {
                setApiError(result.message);
              }
            } catch {
              setApiError("Failed to reject request.");
            } finally {
              setIsPending(false);
            }
          }}
        >
          Reject
        </button>
      </div>
      {apiError && <p className="text-sm text-red-600">{apiError}</p>}
    </div>
  );
}
