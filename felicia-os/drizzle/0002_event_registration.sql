ALTER TABLE "event_registrations" ADD COLUMN "amount_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD COLUMN "hold_started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "programme_events" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "programme_events" ADD COLUMN "includes_breathwork" boolean DEFAULT false NOT NULL;