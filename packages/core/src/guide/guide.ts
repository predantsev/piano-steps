import { z } from 'zod';
import exampleGuideEn from './guide.en.json' with { type: 'json' };

/**
 * The in-app guide ("How to use it"): one record per language, stored in the database and
 * replaced by agents through the API (PUT /api/guide/{lang}). The repo ships one example, in
 * English (guide.en.json) — seeded on first start; every other language lives only in the DB.
 * Docs: docs/guide.md.
 */

export const GuideLang = z
  .string()
  .regex(/^[a-z]{2}$/, 'a two-letter language code, e.g. en or uk')
  .describe('Two-letter language code (ISO 639-1)');

export const GuideSection = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes')
    .max(40)
    .describe('Stable section id (the same in every language)'),
  title: z.string().min(1).max(200),
  body: z
    .array(z.string().min(1).max(4000))
    .max(100)
    .describe('Paragraphs; one starting with "• " is shown as a list item'),
});
export type GuideSection = z.infer<typeof GuideSection>;

export const GuideInput = z.object({
  title: z.string().min(1).max(200),
  sections: z.array(GuideSection).min(1).max(100),
});
export type GuideInput = z.infer<typeof GuideInput>;

export interface Guide extends GuideInput {
  lang: string;
  updatedAt: string;
}

/** The example guide shipped with the code (English). Seed and offline fallback. */
export const EXAMPLE_GUIDE: GuideInput = GuideInput.parse(exampleGuideEn);
