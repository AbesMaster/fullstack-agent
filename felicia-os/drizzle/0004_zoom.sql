ALTER TABLE "bookings" ADD COLUMN "attendance_mode" text DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "video_meeting_id" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "video_join_url" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "video_passcode" text;--> statement-breakpoint
ALTER TABLE "programme_events" ADD COLUMN "is_online" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "programme_events" ADD COLUMN "video_meeting_id" text;--> statement-breakpoint
ALTER TABLE "programme_events" ADD COLUMN "video_join_url" text;--> statement-breakpoint
ALTER TABLE "programme_events" ADD COLUMN "video_passcode" text;--> statement-breakpoint
UPDATE "bookings" SET "attendance_mode" = 'in_person' FROM "services" WHERE "bookings"."service_id" = "services"."id" AND "services"."delivery_mode" = 'in_person';
