ALTER TABLE "chunks" DROP CONSTRAINT "chunks_source_hash_unique";--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "topic" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" drop column "tsv";--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', "chunks"."topic" || ' ' || "chunks"."text")) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "chunks_tsv_idx" ON "chunks" USING gin ("tsv");--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "url" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "article_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "idx" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "period_from" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "period_to" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "wikidata_id" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "period_from" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "period_to" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" DROP COLUMN "text_hash";--> statement-breakpoint
ALTER TABLE "chunks" DROP COLUMN "period";--> statement-breakpoint
ALTER TABLE "sources" DROP COLUMN "period";--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_article_idx_unique" UNIQUE("article_key","idx");--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_url_unique" UNIQUE("url");