export type AuthRedirectState = {
  session: boolean;
  guestMode: boolean;
  passwordRecovery: boolean;
  segments: readonly string[];
};

/**
 * Pure route-guard decision for the root layout: given the current auth
 * state and route segments, returns the href to redirect to, or `null` if
 * the user is already somewhere valid and no navigation is needed.
 *
 * Deliberately does NOT force a guest (`!session && guestMode`) out of the
 * `(auth)` group — a guest who has explicitly navigated to `/sign-in` (e.g.
 * from a `SignInPromptSheet`) must be able to reach and use that screen.
 * The one-time "guest just opted in" redirect belongs to the action that
 * sets `guestMode` (the Welcome screen's "Continue as Guest" button), not
 * to this standing invariant.
 */
export function resolveAuthRedirect(
  state: AuthRedirectState,
): "/welcome" | "/reset-password" | "/" | null {
  const inAuthGroup = state.segments[0] === "(auth)";

  if (!state.session && !state.guestMode) {
    return inAuthGroup ? null : "/welcome";
  }

  if (state.session && state.passwordRecovery) {
    const onResetPassword = inAuthGroup && state.segments[1] === "reset-password";
    return onResetPassword ? null : "/reset-password";
  }

  if (state.session && inAuthGroup) {
    return "/";
  }

  return null;
}
