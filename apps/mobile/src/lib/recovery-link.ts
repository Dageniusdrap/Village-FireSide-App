export type RecoveryLinkResult =
  { kind: "code"; code: string } | { kind: "tokens"; accessToken: string; refreshToken: string };

export function parseRecoveryLink(url: string): RecoveryLinkResult | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const code = parsed.searchParams.get("code");
  if (code && parsed.searchParams.get("type") === "recovery") {
    return { kind: "code", code };
  }

  const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  const hashParams = new URLSearchParams(hash);
  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");
  if (accessToken && refreshToken && hashParams.get("type") === "recovery") {
    return { kind: "tokens", accessToken, refreshToken };
  }

  return null;
}
