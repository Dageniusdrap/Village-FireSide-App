"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { createClient } from "@/lib/supabase/client";
import { type SignInInput, signInSchema } from "@/lib/validation";

export default function SignInPage() {
  const router = useRouter();
  const [apiError, setApiError] = useState<string | undefined>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: SignInInput) => {
    setApiError(undefined);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      setApiError(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  };

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <form onSubmit={handleSubmit(onSubmit)} className="flex w-full max-w-sm flex-col gap-3">
        <h1 className="text-xl font-semibold">Admin Sign In</h1>

        <input
          {...register("email")}
          type="email"
          placeholder="Email"
          autoCapitalize="none"
          className="rounded border border-gray-300 px-3 py-2"
        />
        {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}

        <input
          {...register("password")}
          type="password"
          placeholder="Password"
          className="rounded border border-gray-300 px-3 py-2"
        />
        {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
        {apiError && <p className="text-sm text-red-600">{apiError}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-[#1F3B2C] px-3 py-2 text-white disabled:opacity-50"
        >
          {isSubmitting ? "Signing In…" : "Sign In"}
        </button>
      </form>
    </main>
  );
}
