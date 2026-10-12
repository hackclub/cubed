ALTER TYPE "public"."submission_status" ADD VALUE 'changes_requested';--> statement-breakpoint
DROP INDEX "submissions_project_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_project_pending_unique_idx" ON "submissions" USING btree ("project_id") WHERE "submissions"."status" = 'pending';