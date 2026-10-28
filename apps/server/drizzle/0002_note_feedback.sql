ALTER TABLE "feedback" ADD COLUMN "note_id" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "note" jsonb;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "kind" text;