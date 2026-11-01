CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."box_source" AS ENUM('model', 'estimated');--> statement-breakpoint
CREATE TYPE "public"."chunk_type" AS ENUM('term', 'place', 'date', 'unit', 'abbr');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('person', 'place', 'term', 'date');--> statement-breakpoint
CREATE TYPE "public"."portal" AS ENUM('archium', 'own');--> statement-breakpoint
CREATE TYPE "public"."recognition_source" AS ENUM('extension', 'web', 'mcp', 'batch');--> statement-breakpoint
CREATE TYPE "public"."recognition_status" AS ENUM('queued', 'reading', 'normalizing', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('dictionary', 'encyclopedia', 'wikidata', 'publication');--> statement-breakpoint
CREATE TYPE "public"."transcription_status" AS ENUM('draft', 'verified', 'disputed');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text,
	"key_hash" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" uuid NOT NULL,
	"text" text NOT NULL,
	"text_hash" text NOT NULL,
	"topic" text,
	"type" "chunk_type" NOT NULL,
	"period" text,
	"tsv" "tsvector" NOT NULL,
	CONSTRAINT "chunks_source_hash_unique" UNIQUE("source_id","text_hash")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"archive" text NOT NULL,
	"fond" text NOT NULL,
	"opys" text NOT NULL,
	"sprava" text NOT NULL,
	"title" text,
	"portal" "portal",
	"portal_url" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_shelfmark_unique" UNIQUE("archive","fond","opys","sprava")
);
--> statement-breakpoint
CREATE TABLE "edits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transcription_id" uuid NOT NULL,
	"line_idx" integer NOT NULL,
	"before" text NOT NULL,
	"after" text NOT NULL,
	"author_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transcription_id" uuid NOT NULL,
	"type" "entity_type" NOT NULL,
	"text" text NOT NULL,
	"normalized" text,
	"wikidata_id" text,
	"start_pos" integer NOT NULL,
	"end_pos" integer NOT NULL,
	"extra" jsonb,
	CONSTRAINT "entities_span" CHECK ("entities"."start_pos" >= 0 and "entities"."end_pos" > "entities"."start_pos")
);
--> statement-breakpoint
CREATE TABLE "line_words" (
	"id" uuid PRIMARY KEY NOT NULL,
	"line_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"text" text NOT NULL,
	"uncertain" boolean DEFAULT false NOT NULL,
	"confidence" real,
	CONSTRAINT "line_words_idx_unique" UNIQUE("line_id","idx"),
	CONSTRAINT "line_words_confidence" CHECK ("line_words"."confidence" is null or "line_words"."confidence" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"transcription_id" uuid,
	"excerpt" text,
	"note" text,
	"citation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"folio" text,
	"image_no" integer,
	"source_url" text,
	"image_hash" text,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_document_folio_unique" UNIQUE("document_id","folio"),
	CONSTRAINT "pages_document_image_unique" UNIQUE("document_id","image_no"),
	CONSTRAINT "pages_folio_or_image" CHECK ("pages"."folio" is not null or "pages"."image_no" is not null),
	CONSTRAINT "pages_image_no_positive" CHECK ("pages"."image_no" is null or "pages"."image_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE "recognitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"region_id" uuid NOT NULL,
	"status" "recognition_status" DEFAULT 'queued' NOT NULL,
	"source" "recognition_source" NOT NULL,
	"transcription_id" uuid,
	"error_code" text,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recognitions_attempts_nonnegative" CHECK ("recognitions"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"page_id" uuid,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"w" double precision NOT NULL,
	"h" double precision NOT NULL,
	"image_hash" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regions_box" CHECK ("regions"."x" >= 0 and "regions"."y" >= 0 and "regions"."w" > 0 and "regions"."h" > 0 and "regions"."x" + "regions"."w" <= 1.000001 and "regions"."y" + "regions"."h" <= 1.000001)
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"licence" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"period" text
);
--> statement-breakpoint
CREATE TABLE "synonyms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"term" text NOT NULL,
	"variant" text NOT NULL,
	"type" text NOT NULL,
	CONSTRAINT "synonyms_term_variant_unique" UNIQUE("term","variant")
);
--> statement-breakpoint
CREATE TABLE "transcription_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transcription_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"text" text NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"w" double precision NOT NULL,
	"h" double precision NOT NULL,
	"box_source" "box_source" NOT NULL,
	"confidence" real,
	CONSTRAINT "transcription_lines_idx_unique" UNIQUE("transcription_id","idx"),
	CONSTRAINT "transcription_lines_box" CHECK ("transcription_lines"."x" >= 0 and "transcription_lines"."y" >= 0 and "transcription_lines"."w" > 0 and "transcription_lines"."h" > 0 and "transcription_lines"."x" + "transcription_lines"."w" <= 1.000001 and "transcription_lines"."y" + "transcription_lines"."h" <= 1.000001),
	CONSTRAINT "transcription_lines_confidence" CHECK ("transcription_lines"."confidence" is null or "transcription_lines"."confidence" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "transcriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"region_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "transcription_status" DEFAULT 'draft' NOT NULL,
	"raw_text" text NOT NULL,
	"normalized_text" text DEFAULT '' NOT NULL,
	"reader" text NOT NULL,
	"author_id" text,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcriptions_region_version_unique" UNIQUE("region_id","version"),
	CONSTRAINT "transcriptions_version_positive" CHECK ("transcriptions"."version" >= 1),
	CONSTRAINT "transcriptions_verified_has_time" CHECK ("transcriptions"."status" <> 'verified' or "transcriptions"."verified_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edits" ADD CONSTRAINT "edits_transcription_id_transcriptions_id_fk" FOREIGN KEY ("transcription_id") REFERENCES "public"."transcriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edits" ADD CONSTRAINT "edits_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_transcription_id_transcriptions_id_fk" FOREIGN KEY ("transcription_id") REFERENCES "public"."transcriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_words" ADD CONSTRAINT "line_words_line_id_transcription_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."transcription_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_transcription_id_transcriptions_id_fk" FOREIGN KEY ("transcription_id") REFERENCES "public"."transcriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognitions" ADD CONSTRAINT "recognitions_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognitions" ADD CONSTRAINT "recognitions_transcription_id_transcriptions_id_fk" FOREIGN KEY ("transcription_id") REFERENCES "public"."transcriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_lines" ADD CONSTRAINT "transcription_lines_transcription_id_transcriptions_id_fk" FOREIGN KEY ("transcription_id") REFERENCES "public"."transcriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD CONSTRAINT "transcriptions_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD CONSTRAINT "transcriptions_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD CONSTRAINT "transcriptions_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chunks_tsv_idx" ON "chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "chunks_text_trgm_idx" ON "chunks" USING gin ("text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "edits_transcription_idx" ON "edits" USING btree ("transcription_id");--> statement-breakpoint
CREATE INDEX "entities_transcription_idx" ON "entities" USING btree ("transcription_id");--> statement-breakpoint
CREATE INDEX "entities_normalized_trgm_idx" ON "entities" USING gin ("normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "notes_user_idx" ON "notes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recognitions_active_status_idx" ON "recognitions" USING btree ("status") WHERE "recognitions"."status" in ('queued', 'reading', 'normalizing');--> statement-breakpoint
CREATE INDEX "recognitions_region_idx" ON "recognitions" USING btree ("region_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recognitions_one_active_per_region" ON "recognitions" USING btree ("region_id") WHERE "recognitions"."status" in ('queued', 'reading', 'normalizing');--> statement-breakpoint
CREATE INDEX "regions_image_hash_idx" ON "regions" USING btree ("image_hash");--> statement-breakpoint
CREATE INDEX "regions_page_idx" ON "regions" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "synonyms_variant_trgm_idx" ON "synonyms" USING gin ("variant" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "transcriptions_fts_idx" ON "transcriptions" USING gin (to_tsvector('simple', "normalized_text"));--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");