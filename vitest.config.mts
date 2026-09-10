import { defineConfig } from "vitest/config";
import path from "node:path";
import { config as loadEnv } from "dotenv";

// Vitest doesn't auto-load .env.local the way Next.js does — without this,
// any test whose import chain touches config.server.ts (e.g. a DAL module
// that reads env.API_KEY_HASH_PEPPER) fails on missing env vars, not on the
// behavior it's actually testing. Passed through `test.env` below rather
// than left as a `process.env` mutation, so it reaches every worker
// regardless of the test pool's threading model.
const { parsed: envFromDotFile } = loadEnv({
  path: path.resolve(import.meta.dirname, ".env.local"),
  quiet: true,
});

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // See src/lib/test/server-only-stub.ts for why.
      "server-only": path.resolve(
        import.meta.dirname,
        "./src/lib/test/server-only-stub.ts",
      ),
    },
  },
  test: {
    environment: "node",
    env: envFromDotFile,
  },
});
