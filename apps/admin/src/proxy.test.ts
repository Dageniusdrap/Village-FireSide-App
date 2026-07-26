// apps/admin/src/proxy.test.ts
import { describe, expect, it } from "vitest";

import { decideRedirect } from "./proxy";

describe("decideRedirect", () => {
  it("redirects to /sign-in when there is no user", () => {
    expect(decideRedirect({ user: null, role: null })).toBe("/sign-in");
  });

  it("redirects to /not-authorized when the user is not an admin", () => {
    expect(decideRedirect({ user: { id: "user-1" }, role: "listener" })).toBe("/not-authorized");
  });

  it("redirects to /not-authorized when the profile role could not be read", () => {
    expect(decideRedirect({ user: { id: "user-1" }, role: null })).toBe("/not-authorized");
  });

  it("allows the request through when the user is an admin", () => {
    expect(decideRedirect({ user: { id: "user-1" }, role: "admin" })).toBeNull();
  });
});
