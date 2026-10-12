ALTER TABLE "users" ALTER COLUMN "heard_about_source" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."heard_about_source";--> statement-breakpoint
CREATE TYPE "public"."heard_about_source" AS ENUM('friends_family', 'instagram_youtube', 'hackclub_site', 'slack', 'email', 'school', 'other');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "heard_about_source" SET DATA TYPE "public"."heard_about_source" USING "heard_about_source"::"public"."heard_about_source";