CREATE TYPE "public"."project_share_mode" AS ENUM('view', 'edit');--> statement-breakpoint
CREATE TABLE "project_share" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"token" text NOT NULL,
	"mode" "project_share_mode" NOT NULL,
	"expires_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "project_share_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "project_share" ADD CONSTRAINT "project_share_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_share" ADD CONSTRAINT "project_share_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_share_project_idx" ON "project_share" USING btree ("project_id");