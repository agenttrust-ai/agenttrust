CREATE TABLE "anonymous_rate_limits" (
	"ip_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "anonymous_rate_limits_ip_hash_window_start_pk" PRIMARY KEY("ip_hash","window_start")
);
