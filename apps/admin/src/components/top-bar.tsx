"use client";

import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export function TopBar({ adminName }: { adminName: string }) {
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/sign-in");
    router.refresh();
  };

  return (
    <header className="flex items-center justify-end gap-4 border-b border-gray-200 px-6 py-3">
      <span className="text-sm text-gray-700">{adminName}</span>
      <button onClick={handleSignOut} className="text-sm font-medium text-red-700 hover:underline">
        Sign Out
      </button>
    </header>
  );
}
