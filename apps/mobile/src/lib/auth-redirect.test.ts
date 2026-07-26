import { resolveAuthRedirect } from "./auth-redirect";

const base = {
  session: false,
  guestMode: false,
  passwordRecovery: false,
  segments: [] as string[],
};

describe("resolveAuthRedirect", () => {
  it("sends a signed-out, non-guest user on an app route to welcome", () => {
    expect(resolveAuthRedirect({ ...base, segments: ["(app)", "(tabs)"] })).toBe("/welcome");
  });

  it("leaves a signed-out, non-guest user already on an auth screen alone", () => {
    expect(resolveAuthRedirect({ ...base, segments: ["(auth)", "sign-in"] })).toBeNull();
  });

  it("leaves a guest who navigated to sign-in alone", () => {
    expect(
      resolveAuthRedirect({ ...base, guestMode: true, segments: ["(auth)", "sign-in"] }),
    ).toBeNull();
  });

  it("leaves a guest already browsing the app alone", () => {
    expect(
      resolveAuthRedirect({ ...base, guestMode: true, segments: ["(app)", "(tabs)"] }),
    ).toBeNull();
  });

  it("sends a recovering session anywhere in the app to reset-password", () => {
    expect(
      resolveAuthRedirect({
        ...base,
        session: true,
        passwordRecovery: true,
        segments: ["(app)", "(tabs)"],
      }),
    ).toBe("/reset-password");
  });

  it("leaves a recovering session already on reset-password alone", () => {
    expect(
      resolveAuthRedirect({
        ...base,
        session: true,
        passwordRecovery: true,
        segments: ["(auth)", "reset-password"],
      }),
    ).toBeNull();
  });

  it("leaves a signed-in user already inside the app alone", () => {
    expect(
      resolveAuthRedirect({ ...base, session: true, segments: ["(app)", "series", "[id]"] }),
    ).toBeNull();
  });

  it("sends a signed-in user still on an auth screen home", () => {
    expect(resolveAuthRedirect({ ...base, session: true, segments: ["(auth)", "sign-in"] })).toBe(
      "/",
    );
  });
});
