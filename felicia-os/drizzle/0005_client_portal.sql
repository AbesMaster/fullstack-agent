CREATE TABLE "client_login_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_login_tokens" ADD CONSTRAINT "client_login_tokens_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_login_token_hash_uq" ON "client_login_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "client_login_contact_idx" ON "client_login_tokens" USING btree ("contact_id");