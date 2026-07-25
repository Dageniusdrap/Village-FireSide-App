// apps/mobile/src/stores/auth-store.test.ts
import type { Session } from "@supabase/supabase-js";

import { useAuthStore } from "./auth-store";

// The store imports `@/lib/supabase`, whose module-load `createClient` throws
// without Supabase env vars. These tests exercise pure store logic
// (`_setSession`), which never touches Supabase, so a minimal stub is enough.
jest.mock("@/lib/supabase", () => ({
  supabase: { auth: { signOut: jest.fn() } },
}));

const fakeSession = { access_token: "x", user: { id: "u1" } } as unknown as Session;

describe("useAuthStore._setSession", () => {
  afterEach(() => {
    useAuthStore.setState({ session: null, guestMode: false });
  });

  it("clears guestMode when a real session is set", () => {
    useAuthStore.setState({ session: null, guestMode: true });

    useAuthStore.getState()._setSession(fakeSession);

    expect(useAuthStore.getState().session).toBe(fakeSession);
    expect(useAuthStore.getState().guestMode).toBe(false);
  });

  it("leaves an existing guestMode value untouched when session is null", () => {
    useAuthStore.setState({ session: null, guestMode: true });

    useAuthStore.getState()._setSession(null);

    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().guestMode).toBe(true);
  });
});
