ALTER TABLE "projects" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_nickname_lower_unique" ON "users" USING btree (lower("nickname"));