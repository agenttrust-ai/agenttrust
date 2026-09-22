import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/config";

/**
 * Deliberately minimal and static: only the real, public, non-auth-gated
 * pages worth indexing. Does not enumerate individual agent profile pages
 * (/a/{slug}) -- that set changes constantly and isn't this task's scope;
 * those remain discoverable via the Public API / MCP tools instead.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicEnv.NEXT_PUBLIC_APP_URL;
  return [
    { url: base, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/docs`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/check-agent-trust`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/signup`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${base}/login`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
