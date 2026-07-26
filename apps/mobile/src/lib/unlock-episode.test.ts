import { FunctionsHttpError } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

import { unlockEpisode } from "./unlock-episode";

jest.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const mockInvoke = supabase.functions.invoke as jest.Mock;

describe("unlockEpisode", () => {
  it("maps a 200 { ok: true } response to unlocked", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    expect(await unlockEpisode("ep-1")).toEqual({ type: "unlocked" });
  });

  it("maps a 402 insufficient_coins response to insufficient_coins with balance/price", async () => {
    const response = new Response(
      JSON.stringify({ error: "insufficient_coins", balance: 20, price: 50 }),
      { status: 402 },
    );
    mockInvoke.mockResolvedValueOnce({ data: null, error: new FunctionsHttpError(response) });
    expect(await unlockEpisode("ep-2")).toEqual({
      type: "insufficient_coins",
      balance: 20,
      price: 50,
    });
  });

  it("maps a 400 response to not_coin_gated", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(new Response(null, { status: 400 })),
    });
    expect(await unlockEpisode("ep-3")).toEqual({ type: "not_coin_gated" });
  });

  it("maps a 404 response to not_found", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(new Response(null, { status: 404 })),
    });
    expect(await unlockEpisode("ep-4")).toEqual({ type: "not_found" });
  });

  it("maps a 401 response to unauthorized", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(new Response(null, { status: 401 })),
    });
    expect(await unlockEpisode("ep-5")).toEqual({ type: "unauthorized" });
  });

  it("maps a 500 response to error", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(new Response(null, { status: 500 })),
    });
    expect(await unlockEpisode("ep-6")).toEqual({ type: "error" });
  });

  it("maps a network/relay error (no FunctionsHttpError) to error", async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error("network down") });
    expect(await unlockEpisode("ep-7")).toEqual({ type: "error" });
  });

  it("maps a 200 response missing ok:true to error", async () => {
    mockInvoke.mockResolvedValueOnce({ data: {}, error: null });
    expect(await unlockEpisode("ep-8")).toEqual({ type: "error" });
  });

  it("defaults balance/price to 0 if the 402 body is malformed", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(new Response("not json", { status: 402 })),
    });
    expect(await unlockEpisode("ep-9")).toEqual({
      type: "insufficient_coins",
      balance: 0,
      price: 0,
    });
  });
});
