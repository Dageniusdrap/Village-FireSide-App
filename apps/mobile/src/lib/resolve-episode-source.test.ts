import { FunctionsHttpError } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

import { resolveEpisodeSource } from "./resolve-episode-source";

jest.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));
jest.mock("./local-downloads", () => ({
  getLocalDownloadPath: jest.fn().mockResolvedValue(null),
}));

const mockInvoke = supabase.functions.invoke as jest.Mock;

describe("resolveEpisodeSource", () => {
  it("returns a local source without calling the edge function when a local file exists", async () => {
    jest
      .requireMock("./local-downloads")
      .getLocalDownloadPath.mockResolvedValueOnce("/local/ep-1.m4a");

    const result = await resolveEpisodeSource("ep-1");

    expect(result).toEqual({ type: "local", path: "/local/ep-1.m4a" });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("maps a 200 response to a remote source", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { signedUrl: "https://example.com/signed.m4a", expiresIn: 21600 },
      error: null,
    });

    const result = await resolveEpisodeSource("ep-2");

    expect(result).toEqual({ type: "remote", url: "https://example.com/signed.m4a" });
  });

  it("maps a 403 response to locked", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(new Response(null, { status: 403 })),
    });

    expect(await resolveEpisodeSource("ep-3")).toEqual({ type: "locked" });
  });

  it("maps a 404 response to not_found", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(new Response(null, { status: 404 })),
    });

    expect(await resolveEpisodeSource("ep-4")).toEqual({ type: "not_found" });
  });

  it("maps a 400 response to error", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(new Response(null, { status: 400 })),
    });

    expect(await resolveEpisodeSource("ep-5")).toEqual({ type: "error" });
  });

  it("maps a 500 response to error", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(new Response(null, { status: 500 })),
    });

    expect(await resolveEpisodeSource("ep-6")).toEqual({ type: "error" });
  });

  it("maps a network/relay error (no FunctionsHttpError) to error", async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error("network down") });

    expect(await resolveEpisodeSource("ep-7")).toEqual({ type: "error" });
  });

  it("maps a 200 response missing signedUrl to error", async () => {
    mockInvoke.mockResolvedValueOnce({ data: {}, error: null });

    expect(await resolveEpisodeSource("ep-8")).toEqual({ type: "error" });
  });
});
