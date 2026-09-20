import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/config";

/**
 * Explicit allow-all robots directive. This changes no actual crawling
 * behavior (a site with no robots.txt at all is already crawlable by
 * default) -- it exists so search engines and AI crawlers get an explicit,
 * unambiguous signal (and a discoverable sitemap link) rather than having
 * to assume the absence of a file means "allowed".
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/api/internal"],
    },
    sitemap: `${publicEnv.NEXT_PUBLIC_APP_URL}/sitemap.xml`,
  };
}
