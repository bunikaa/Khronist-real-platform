CREATE TABLE "model_calls" (
	"day" date PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "model_calls_nonnegative" CHECK ("model_calls"."calls" >= 0)
);
--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "normalized_lines" jsonb;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "expansions" jsonb;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "warnings" text[] DEFAULT '{}'::text[] NOT NULL;