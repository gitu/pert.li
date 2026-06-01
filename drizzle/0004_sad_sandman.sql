CREATE TABLE "project_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"edited_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "parent_project_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "branched_from_heads" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "branched_at" timestamp;--> statement-breakpoint
ALTER TABLE "project_comment" ADD CONSTRAINT "project_comment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_comment" ADD CONSTRAINT "project_comment_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_comment_project_idx" ON "project_comment" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_parent_project_id_project_id_fk" FOREIGN KEY ("parent_project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_parent_idx" ON "project" USING btree ("parent_project_id");