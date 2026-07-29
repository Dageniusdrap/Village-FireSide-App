import { resolveOfflineLaunchRedirect } from "./offline-redirect";

describe("resolveOfflineLaunchRedirect", () => {
  it("does nothing when connected", () => {
    expect(
      resolveOfflineLaunchRedirect({ isConnected: true, segments: ["(app)", "(tabs)"] }),
    ).toBeNull();
  });

  it("redirects to Library when offline and landing on the Home tab", () => {
    expect(
      resolveOfflineLaunchRedirect({ isConnected: false, segments: ["(app)", "(tabs)"] }),
    ).toBe("/library");
  });

  it("leaves a deep-linked route alone even when offline", () => {
    expect(
      resolveOfflineLaunchRedirect({
        isConnected: false,
        segments: ["(app)", "series", "[id]"],
      }),
    ).toBeNull();
  });

  it("leaves an auth-group route alone even when offline", () => {
    expect(
      resolveOfflineLaunchRedirect({ isConnected: false, segments: ["(auth)", "sign-in"] }),
    ).toBeNull();
  });
});
