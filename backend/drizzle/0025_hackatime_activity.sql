CREATE TABLE "hackatime_activity" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"seconds" integer NOT NULL,
	CONSTRAINT "hackatime_activity_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "hackatime_activity_names" text;--> statement-breakpoint
ALTER TABLE "hackatime_activity" ADD CONSTRAINT "hackatime_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hackatime_activity_day_idx" ON "hackatime_activity" USING btree ("day");
