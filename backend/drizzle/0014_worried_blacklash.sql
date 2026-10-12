CREATE TYPE "public"."ysws_status" AS ENUM('needs_submission', 'pending', 'verified_eligible', 'verified_but_over_18', 'rejected', 'not_found');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "hackatime_banned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ysws_status" "ysws_status";