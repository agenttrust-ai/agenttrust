ALTER TABLE "agents" ADD COLUMN "endpoint_url_normalized" text;--> statement-breakpoint
CREATE INDEX "agents_endpoint_url_normalized_idx" ON "agents" USING btree ("endpoint_url_normalized");