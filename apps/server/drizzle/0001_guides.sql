CREATE TABLE "guides" (
	"lang" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"sections" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
