DROP INDEX "transcriptions_fts_idx";--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', "transcriptions"."normalized_text")) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "transcriptions_tsv_idx" ON "transcriptions" USING gin ("tsv");