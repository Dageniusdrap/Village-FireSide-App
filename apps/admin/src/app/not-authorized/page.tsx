"use client";

import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export default function NotAuthorizedPage() {
  const router = useRouter();

  const handleBackToSignIn = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/sign-in");
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold">Not Authorized</h1>
      <p>This account doesn&apos;t have admin access to Village Fireside.</p>
      <button onClick={handleBackToSignIn} className="rounded bg-[#1F3B2C] px-3 py-2 text-white">
        Back to Sign In
      </button>
    </main>
  );
}
