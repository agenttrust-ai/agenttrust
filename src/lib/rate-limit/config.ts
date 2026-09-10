import "server-only";

/**
 * Every API key currently gets the same flat limit. When plans/tiers exist,
 * this is the one place that needs to change — look up the key's (or its
 * owner's) plan and return a per-tier limit instead of this default.
 * Nothing else in the request path should know about plans.
 */
export const RATE_LIMIT_WINDOW_SECONDS = 60;
export const DEFAULT_RATE_LIMIT_PER_WINDOW = 100;
