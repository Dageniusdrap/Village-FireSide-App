// apps/mobile/src/lib/recovery-link.test.ts
import { parseRecoveryLink } from "./recovery-link";

describe("parseRecoveryLink", () => {
  it("parses a PKCE-style recovery link into a code result", () => {
    const result = parseRecoveryLink("villagefireside://reset-password?code=abc123&type=recovery");
    expect(result).toEqual({ kind: "code", code: "abc123" });
  });

  it("parses an implicit/hash-style recovery link into a tokens result", () => {
    const result = parseRecoveryLink(
      "villagefireside://reset-password#access_token=aaa&refresh_token=bbb&type=recovery",
    );
    expect(result).toEqual({ kind: "tokens", accessToken: "aaa", refreshToken: "bbb" });
  });

  it("returns null when type is missing or not 'recovery'", () => {
    expect(parseRecoveryLink("villagefireside://reset-password?code=abc123")).toBeNull();
    expect(
      parseRecoveryLink("villagefireside://reset-password?code=abc123&type=signup"),
    ).toBeNull();
    expect(
      parseRecoveryLink("villagefireside://reset-password#access_token=aaa&refresh_token=bbb"),
    ).toBeNull();
  });

  it("returns null when there is no code and no tokens", () => {
    expect(parseRecoveryLink("villagefireside://reset-password")).toBeNull();
    expect(parseRecoveryLink("villagefireside://reset-password?type=recovery")).toBeNull();
  });

  it("returns null for a malformed/unparseable URL string", () => {
    expect(parseRecoveryLink("not a url")).toBeNull();
    expect(parseRecoveryLink("")).toBeNull();
  });
});
