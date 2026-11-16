CREATE INDEX "synonyms_term_lower_idx" ON "synonyms" USING btree (lower("term"));--> statement-breakpoint
CREATE INDEX "synonyms_variant_lower_idx" ON "synonyms" USING btree (lower("variant"));