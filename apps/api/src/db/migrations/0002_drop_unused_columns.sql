ALTER TABLE "transcription_lines" DROP CONSTRAINT "transcription_lines_confidence";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "portal_url";--> statement-breakpoint
ALTER TABLE "pages" DROP COLUMN "image_hash";--> statement-breakpoint
ALTER TABLE "pages" DROP COLUMN "width";--> statement-breakpoint
ALTER TABLE "pages" DROP COLUMN "height";--> statement-breakpoint
ALTER TABLE "transcription_lines" DROP COLUMN "confidence";