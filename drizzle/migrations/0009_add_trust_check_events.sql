CREATE TABLE "trust_check_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"surface" text NOT NULL,
	"outcome" text NOT NULL,
	"agent_id" uuid,
	"recommended" boolean,
	"confidence" text,
	"endpoint_host" text,
	"endpoint_key" text,
	"caller_key" text,
	"client_family" text,
	CONSTRAINT "trust_check_events_surface_valid" CHECK ("trust_check_events"."surface" in ('mcp', 'web')),
	CONSTRAINT "trust_check_events_outcome_valid" CHECK ("trust_check_events"."outcome" in ('matched', 'not_matched')),
	CONSTRAINT "trust_check_events_endpoint_host_length" CHECK (char_length("trust_check_events"."endpoint_host") <= 253),
	CONSTRAINT "trust_check_events_client_family_length" CHECK (char_length("trust_check_events"."client_family") <= 64)
);
--> statement-breakpoint
ALTER TABLE "trust_check_events" ADD CONSTRAINT "trust_check_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trust_check_events_occurred_at_idx" ON "trust_check_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "trust_check_events_unmatched_endpoint_idx" ON "trust_check_events" USING btree ("endpoint_key") WHERE "trust_check_events"."outcome" = 'not_matched';--> statement-breakpoint
-- Server-written telemetry only: RLS on with no policies denies the anon and
-- authenticated roles entirely (same pattern as anonymous_rate_limits).
ALTER TABLE "trust_check_events" ENABLE ROW LEVEL SECURITY;
