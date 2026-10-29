CREATE TABLE "fragment_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"fragment_position" integer NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"later" boolean DEFAULT false NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fragment_notes_lesson_fragment" UNIQUE("lesson_id","fragment_position")
);
--> statement-breakpoint
ALTER TABLE "fragment_notes" ADD CONSTRAINT "fragment_notes_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;