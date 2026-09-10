import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

const directUrl = process.env.DIRECT_URL!;
const isLocal = ["localhost", "127.0.0.1", "::1"].includes(
  (() => {
    try {
      return new URL(directUrl).hostname;
    } catch {
      return "";
    }
  })(),
);

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  // Migrations run over the direct (non-pooled) connection — required
  // because pooled/pgbouncer connections don't support every DDL operation.
  // `ssl` is explicit rather than relying on a `sslmode` query param in the
  // URL surviving intact — see src/lib/db/index.ts for the same reasoning.
  dbCredentials: { url: directUrl, ssl: isLocal ? false : "require" },
  // Supabase owns `auth`, `storage`, etc. — never let drizzle-kit touch
  // anything outside the schema this app actually manages.
  schemaFilter: ["public"],
});
