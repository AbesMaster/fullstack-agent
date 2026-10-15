CREATE TABLE "analytics_events" (
	"id" text PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"label" text,
	"referrer_host" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"device" text NOT NULL,
	"visitor_hash" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "analytics_day_idx" ON "analytics_events" USING btree ("day");--> statement-breakpoint
CREATE INDEX "analytics_name_day_idx" ON "analytics_events" USING btree ("name","day");