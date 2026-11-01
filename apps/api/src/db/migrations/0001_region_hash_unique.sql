DROP INDEX "regions_image_hash_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "regions_image_hash_unique" ON "regions" USING btree ("image_hash");