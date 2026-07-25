import type { Session } from "@supabase/supabase-js";
import { create } from "zustand";

import { supabase } from "@/lib/supabase";

type AuthState = {
  session: Session | null;
  guestMode: boolean;
  passwordRecovery: boolean;
  loading: boolean;
  continueAsGuest: () => void;
  signOut: () => Promise<void>;
  _setSession: (session: Session | null) => void;
  _setLoading: (loading: boolean) => void;
  _setPasswordRecovery: (passwordRecovery: boolean) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  guestMode: false,
  passwordRecovery: false,
  loading: true,
  continueAsGuest: () => set({ guestMode: true }),
  signOut: async () => {
    await supabase.auth.signOut();
    set({ guestMode: false, passwordRecovery: false });
  },
  _setSession: (session) =>
    set((state) => ({ session, guestMode: session ? false : state.guestMode })),
  _setLoading: (loading) => set({ loading }),
  _setPasswordRecovery: (passwordRecovery) => set({ passwordRecovery }),
}));
