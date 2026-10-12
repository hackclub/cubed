DROP TABLE "goals" CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "last_read_announcements_at";--> statement-breakpoint
DROP TYPE "public"."goal_unit";