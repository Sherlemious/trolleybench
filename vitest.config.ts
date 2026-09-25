import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    environment: "node",
    // The store and session tests boot a real Postgres (PGlite, WASM) per test. On a
    // loaded machine that alone can pass the 10 s default, and a timeout there says
    // nothing about the code under test.
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
