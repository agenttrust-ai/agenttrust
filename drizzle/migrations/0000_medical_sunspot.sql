CREATE TYPE "public"."agent_lifecycle" AS ENUM('draft', 'pending_verification', 'active', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('unknown', 'healthy', 'degraded', 'down');--> statement-breakpoint
CREATE TYPE "public"."agent_visibility" AS ENUM('public', 'unlisted');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"capability_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" text,
	"endpoint_url" text NOT NULL,
	"health_check_url" text,
	"mcp_server_url" text,
	"repo_url" text,
	"contact_email" text,
	"agent_card" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"agent_card_schema_version" text DEFAULT '1.0' NOT NULL,
	"visibility" "agent_visibility" DEFAULT 'public' NOT NULL,
	"lifecycle_status" "agent_lifecycle" DEFAULT 'draft' NOT NULL,
	"monitoring_mode" text DEFAULT 'pull' NOT NULL,
	"check_interval_seconds" integer DEFAULT 300 NOT NULL,
	"current_status" "agent_status" DEFAULT 'unknown' NOT NULL,
	"next_check_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_slug_unique" UNIQUE("slug"),
	CONSTRAINT "monitoring_mode_valid" CHECK ("agents"."monitoring_mode" in ('pull','push')),
	CONSTRAINT "check_interval_floor" CHECK ("agents"."check_interval_seconds" >= 60),
	CONSTRAINT "endpoint_is_https" CHECK ("agents"."endpoint_url" ~ '^https://')
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"agent_id" uuid,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{read}'::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"agent_id" uuid,
	"action" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text NOT NULL,
	"success" boolean NOT NULL,
	"latency_ms" integer,
	"status_code" integer,
	"error_message" text,
	CONSTRAINT "health_check_method_valid" CHECK ("health_checks"."method" in ('pull','push'))
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"severity" text NOT NULL,
	"trigger_check_id" uuid,
	"summary" text,
	CONSTRAINT "incident_severity_valid" CHECK ("incidents"."severity" in ('degraded','down'))
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reliability_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"uptime_subscore" numeric(5, 2) NOT NULL,
	"latency_subscore" numeric(5, 2) NOT NULL,
	"consistency_subscore" numeric(5, 2) NOT NULL,
	"incident_subscore" numeric(5, 2) NOT NULL,
	"formula_version" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_checks" ADD CONSTRAINT "health_checks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_trigger_check_id_health_checks_id_fk" FOREIGN KEY ("trigger_check_id") REFERENCES "public"."health_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reliability_scores" ADD CONSTRAINT "reliability_scores_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_owner_idx" ON "agents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "agents_visibility_status_idx" ON "agents" USING btree ("visibility","lifecycle_status");--> statement-breakpoint
CREATE INDEX "api_keys_owner_idx" ON "api_keys" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "audit_log_agent_idx" ON "audit_log" USING btree ("agent_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "health_checks_agent_time_idx" ON "health_checks" USING btree ("agent_id","checked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "incidents_agent_idx" ON "incidents" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "scores_agent_time_idx" ON "reliability_scores" USING btree ("agent_id","computed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "usage_counters_key_window_idx" ON "usage_counters" USING btree ("api_key_id","window_start");