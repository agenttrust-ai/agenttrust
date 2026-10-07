-- Security: trust- and security-derived columns become server-only.
--
-- supabase/migrations/0001_rls_and_triggers.sql granted the `authenticated`
-- role INSERT/UPDATE on whole tables, and the "agents: owners manage" RLS
-- policy restricts rows, not columns. So any signed-in owner could write
-- every column of their own agent through the Supabase Data API — including
-- ownership_verified_at (a "verified" badge with no proof), current_status
-- and last_heartbeat_at (forged health) — bypassing the application's
-- proof-check and monitoring code entirely.
--
-- After this migration the application writes those columns only from its
-- trusted server-side context (`withServerContext` in src/lib/db/rls.ts,
-- the same direct connection the monitoring cron already uses), always
-- scoped by owner_id itself. The `authenticated` role keeps:
--   * SELECT and DELETE on its own agents (RLS-scoped, unchanged), and
--   * UPDATE on the purely descriptive columns an owner controls.
-- No INSERT: owner_id is server-only and an agent row can't exist without
-- one, so agents are created only by the server.
--
-- Columns added to `agents` later are not granted to `authenticated` by
-- default — a new owner-editable column needs an explicit GRANT.
--
-- Re-running 0001's blanket GRANT would undo this; re-apply this migration's
-- grants afterwards if that's ever done.

REVOKE INSERT, UPDATE, TRUNCATE ON TABLE "public"."agents" FROM "authenticated";
--> statement-breakpoint
REVOKE INSERT, UPDATE, TRUNCATE ON TABLE "public"."agents" FROM "anon";
--> statement-breakpoint
GRANT UPDATE ("name", "description", "version", "capability_tags", "agent_card", "updated_at")
  ON TABLE "public"."agents" TO "authenticated";
--> statement-breakpoint

-- Ownership verification proves control of one origin. Whenever an agent's
-- endpoint changes — through the application or any other path — the old
-- proof must not carry over to the new endpoint. The application already
-- clears these in `updateOwnedAgent`; this enforces it in the database too.
CREATE OR REPLACE FUNCTION "public"."agents_reset_ownership_on_endpoint_change"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.ownership_verified_at := NULL;
  NEW.ownership_verification_token := NULL;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."agents_reset_ownership_on_endpoint_change"() FROM PUBLIC, "anon", "authenticated";
--> statement-breakpoint
CREATE TRIGGER "agents_reset_ownership_on_endpoint_change"
  BEFORE UPDATE OF "endpoint_url" ON "public"."agents"
  FOR EACH ROW
  WHEN (OLD."endpoint_url" IS DISTINCT FROM NEW."endpoint_url")
  EXECUTE FUNCTION "public"."agents_reset_ownership_on_endpoint_change"();
--> statement-breakpoint

-- api_keys: the owner may revoke their own key (the only update the
-- application makes as the owner), and nothing else. Revocation is final:
-- a revoked key must never authenticate again, so clearing or changing
-- revoked_at is rejected for every role.
REVOKE UPDATE, TRUNCATE ON TABLE "public"."api_keys" FROM "authenticated";
--> statement-breakpoint
REVOKE UPDATE, TRUNCATE ON TABLE "public"."api_keys" FROM "anon";
--> statement-breakpoint
GRANT UPDATE ("revoked_at") ON TABLE "public"."api_keys" TO "authenticated";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."api_keys_revocation_is_final"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'API key revocation is permanent.'
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."api_keys_revocation_is_final"() FROM PUBLIC, "anon", "authenticated";
--> statement-breakpoint
CREATE TRIGGER "api_keys_revocation_is_final"
  BEFORE UPDATE OF "revoked_at" ON "public"."api_keys"
  FOR EACH ROW
  WHEN (OLD."revoked_at" IS NOT NULL AND NEW."revoked_at" IS DISTINCT FROM OLD."revoked_at")
  EXECUTE FUNCTION "public"."api_keys_revocation_is_final"();
