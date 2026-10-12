CREATE TABLE "observation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_key" text NOT NULL,
	"endpoint_host" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"agent_id" uuid,
	"request_count" integer DEFAULT 1 NOT NULL,
	"lookup_attempts" integer DEFAULT 0 NOT NULL,
	"first_requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "observation_requests_endpoint_key_unique" UNIQUE("endpoint_key"),
	CONSTRAINT "observation_requests_status_valid" CHECK ("observation_requests"."status" in ('pending', 'observing', 'not_in_registry')),
	CONSTRAINT "observation_requests_endpoint_host_length" CHECK (char_length("observation_requests"."endpoint_host") <= 253)
);
--> statement-breakpoint
ALTER TABLE "observation_requests" ADD CONSTRAINT "observation_requests_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "observation_requests_status_first_requested_idx" ON "observation_requests" USING btree ("status","first_requested_at");--> statement-breakpoint
-- Server-written only: RLS on with no policies denies the anon and
-- authenticated roles (same pattern as trust_check_events), and they get
-- no table privileges at all.
ALTER TABLE "observation_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "observation_requests" FROM "anon", "authenticated";
