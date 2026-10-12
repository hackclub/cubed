-- The old "needs changes -> resubmit" path could leave a project with several
-- submission rows. That path no longer exists (one submission per project),
-- so keep only each project's latest before enforcing it.
DELETE FROM "submissions" a USING "submissions" b WHERE a."project_id" = b."project_id" AND (a."submitted_at" < b."submitted_at" OR (a."submitted_at" = b."submitted_at" AND a."id" < b."id"));--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_project_unique_idx" ON "submissions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_earned_ref_unique_idx" ON "transactions" USING btree ("ref_id") WHERE "transactions"."type" = 'earned' and "transactions"."ref_id" is not null;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_moles_balance_nonneg" CHECK ("users"."moles_balance" >= 0);
