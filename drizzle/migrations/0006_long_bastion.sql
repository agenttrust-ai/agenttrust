CREATE TYPE "public"."agent_source" AS ENUM('owner_registered', 'externally_observed');--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "owner_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "source" "agent_source" DEFAULT 'owner_registered' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "external_registry_id" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "discovered_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_external_registry_id_idx" ON "agents" USING btree ("external_registry_id") WHERE "agents"."external_registry_id" is not null;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_source_owner_consistency" CHECK (("agents"."source" = 'owner_registered' and "agents"."owner_id" is not null) or ("agents"."source" = 'externally_observed' and "agents"."owner_id" is null));--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_external_source_has_registry_id" CHECK ("agents"."source" = 'owner_registered' or "agents"."external_registry_id" is not null);