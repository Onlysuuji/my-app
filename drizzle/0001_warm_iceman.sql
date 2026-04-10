CREATE TABLE "library_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" double precision DEFAULT extract(epoch from now()) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN "sort_order" double precision DEFAULT extract(epoch from now()) NOT NULL;--> statement-breakpoint
ALTER TABLE "library_folders" ADD CONSTRAINT "library_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_folders_user_id_idx" ON "library_folders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "library_folders_sort_order_idx" ON "library_folders" USING btree ("sort_order");--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_folder_id_library_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."library_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_items_folder_id_idx" ON "library_items" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "library_items_sort_order_idx" ON "library_items" USING btree ("sort_order");