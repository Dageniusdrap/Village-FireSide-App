import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Hang guard only. No test asserts on elapsed time.
    testTimeout: 300_000,
    hookTimeout: 120_000,
    // Tests share one local database; run files one at a time.
    fileParallelism: false,
  },
});
