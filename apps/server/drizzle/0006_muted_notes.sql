CREATE TABLE "muted_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"note_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "muted_notes_lesson_note" UNIQUE("lesson_id","note_id")
);
--> statement-breakpoint
ALTER TABLE "muted_notes" ADD CONSTRAINT "muted_notes_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;