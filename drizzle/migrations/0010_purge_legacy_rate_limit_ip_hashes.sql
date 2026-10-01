-- Data-only, one-time cleanup: no schema change.
--
-- Before commit 2586655 (live 2026-10-01 14:24 UTC) per-IP buckets were keyed
-- by an unsalted SHA-256 of the caller's IP, which is reversible by hashing
-- the IPv4 space. New buckets use a keyed, daily-rotating HMAC, and the app
-- now sweeps expired buckets opportunistically. This removes the backlog of
-- per-IP buckets older than one day (the same retention the app applies) in
-- one pass. A bucket is only ever read during its own 60-second window, so
-- nothing older than a day can affect a rate-limit decision. GLOBAL buckets
-- hold aggregate counts with no personal data and are kept.
DELETE FROM "anonymous_rate_limits"
WHERE "ip_hash" <> 'GLOBAL'
  AND "window_start" < now() - interval '1 day';
