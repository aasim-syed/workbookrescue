CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"bucket" bigint NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limits_key_bucket_pk" PRIMARY KEY("key","bucket")
);
