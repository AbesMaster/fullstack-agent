CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"rating" integer,
	"comment" text,
	"consent_to_publish" boolean DEFAULT false NOT NULL,
	"publish_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_booking_uq" ON "feedback" USING btree ("booking_id");