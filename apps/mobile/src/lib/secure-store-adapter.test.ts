// apps/mobile/src/lib/secure-store-adapter.test.ts
import * as SecureStore from "expo-secure-store";

import { secureStoreAdapter } from "./secure-store-adapter";

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn((key: string) =>
      Promise.resolve(store.has(key) ? (store.get(key) as string) : null),
    ),
    setItemAsync: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

describe("secureStoreAdapter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("round-trips a small value through the plain key", async () => {
    await secureStoreAdapter.setItem("key-a", "short-value");

    expect(await secureStoreAdapter.getItem("key-a")).toBe("short-value");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("key-a", "short-value");
  });

  it("chunks a value larger than the per-key ceiling and reassembles it on read", async () => {
    const large = "x".repeat(5000);
    await secureStoreAdapter.setItem("key-b", large);

    expect(await secureStoreAdapter.getItem("key-b")).toBe(large);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith("key-b", large);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("key-b.chunks", expect.any(String));
  });

  it("removes every chunk key and the count key when removing a chunked value", async () => {
    const large = "y".repeat(5000);
    await secureStoreAdapter.setItem("key-c", large);

    await secureStoreAdapter.removeItem("key-c");

    expect(await secureStoreAdapter.getItem("key-c")).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("key-c.chunks");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("key-c.0");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("key-c");
  });

  it("getItem returns null for a key that was never set", async () => {
    expect(await secureStoreAdapter.getItem("key-d")).toBeNull();
  });

  it("setItem on an existing chunked key clears the old chunks first", async () => {
    const large = "z".repeat(5000);
    await secureStoreAdapter.setItem("key-e", large);
    await secureStoreAdapter.setItem("key-e", "short-again");

    expect(await secureStoreAdapter.getItem("key-e")).toBe("short-again");
  });
});
