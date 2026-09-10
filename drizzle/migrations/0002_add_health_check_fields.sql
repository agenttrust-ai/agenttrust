CREATE TYPE "public"."health_check_status" AS ENUM('success', 'http_error', 'timeout', 'dns_error', 'tls_error', 'connection_error', 'ssrf_blocked', 'unknown_error');--> statement-breakpoint
ALTER TABLE "health_checks" ADD COLUMN "status" "health_check_status" NOT NULL;--> statement-breakpoint
ALTER TABLE "health_checks" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "health_checks" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "health_checks_checked_at_idx" ON "health_checks" USING btree ("checked_at");