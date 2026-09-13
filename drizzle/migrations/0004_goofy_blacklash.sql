ALTER TABLE "agents" ADD COLUMN "ownership_verification_token" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "ownership_verified_at" timestamp with time zone;