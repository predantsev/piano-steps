import { z } from 'zod';
import guideEn from './guide.en.json' with { type: 'json' };
import guideUk from './guide.uk.json' with { type: 'json' };

/**
 * The in-app guide ("How to use it"). The source of truth is the files next to this one —
 * guide.<lang>.json, one per UI language — bundled into the app, so the guide is versioned with the
 * code it describes. The API can put a TEMPORARY override in the database (PUT /api/guide/{lang});
 * it is shown instead of the file until someone moves it into the file and deletes it.
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

/** Where the text came from: the repo file, or a temporary override saved through the API. */
export type GuideSource = 'repo' | 'override';

export interface Guide extends GuideInput {
  lang: string;
  source: GuideSource;
  /** Override only: when it was saved. */
  updatedAt?: string;
}

/** The guides shipped with the code, by language. Every UI language has one. */
export const BUNDLED_GUIDES: Readonly<Record<string, GuideInput>> = {
  en: GuideInput.parse(guideEn),
  uk: GuideInput.parse(guideUk),
};

/** The bundled guide in `lang`, else English. */
export function bundledGuide(lang: string): Guide {
  const l = lang in BUNDLED_GUIDES ? lang : 'en';
  return { lang: l, source: 'repo', ...BUNDLED_GUIDES[l] };
}
