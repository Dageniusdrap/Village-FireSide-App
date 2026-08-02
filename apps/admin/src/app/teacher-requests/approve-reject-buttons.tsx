"use client";

import { useState } from "react";

import { approveTeacherRequest, rejectTeacherRequest } from "./actions";

export function ApproveRejectButtons({ requestId, userId }: { requestId: string; userId: string }) {
  const [isPending, setIsPending] = useState(false);

  return (
    <div className="flex gap-2">
      <button
        disabled={isPending}
        className="rounded bg-[#1F3B2C] px-2 py-1 text-sm text-white disabled:opacity-50"
        onClick={async () => {
          setIsPending(true);
          await approveTeacherRequest(requestId, userId);
          setIsPending(false);
        }}
      >
        Approve
      </button>
      <button
        disabled={isPending}
        className="rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-50"
        onClick={async () => {
          setIsPending(true);
          await rejectTeacherRequest(requestId);
          setIsPending(false);
        }}
      >
        Reject
      </button>
    </div>
  );
}
