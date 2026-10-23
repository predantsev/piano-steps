import type { Lang } from '../../settings.ts';

/** Strings of the "Sheet + keys" variant (kept here so parallel work never collides on i18n.ts). */
const S = {
  play: { uk: 'Грати', en: 'Play' },
  stop: { uk: 'Стоп', en: 'Stop' },
  loop: { uk: 'Повтор', en: 'Loop' },
  speed: { uk: 'Темп', en: 'Speed' },
  listen: { uk: 'Слухати', en: 'Listen' },
  step: { uk: 'По кроках', en: 'Steps' },
  next: { uk: 'Далі', en: 'Next' },
  back: { uk: 'Назад', en: 'Back' },
  again: { uk: 'Ще раз', en: 'Again' },
  gotIt: { uk: 'Вивчено', en: 'Got it' },
  names: { uk: 'Назви', en: 'Names' },
  namesHint: { uk: 'Назви нот під нотами', en: 'Note names under the notes' },
  colours: { uk: 'Руки', en: 'Hands' },
  coloursHint: { uk: 'Кольори рук: права / ліва', en: 'Hand colours: right / left' },
  prevFragment: { uk: 'Попередній фрагмент', en: 'Previous fragment' },
  nextFragment: { uk: 'Наступний фрагмент', en: 'Next fragment' },
  fragments: { uk: 'Фрагменти', en: 'Fragments' },
  stepOf: { uk: 'Крок', en: 'Step' },
  done: { uk: 'Фрагмент пройдено', en: 'Fragment done' },
  spaceHint: { uk: 'Пробіл', en: 'Space' },
  notHere: { uk: 'немає в цьому фрагменті', en: 'not in this fragment' },
  approx: {
    uk: 'Ритм приблизний: запис не рівно по долях',
    en: 'Rhythm is approximate: the recording is not on the beat grid',
  },
  estimated: { uk: 'темп оцінено', en: 'tempo estimated' },
  loadingFont: { uk: 'Завантажую нотний шрифт…', en: 'Loading the music font…' },
  right: { uk: 'права', en: 'right' },
  left: { uk: 'ліва', en: 'left' },
  mastered: { uk: 'вивчено', en: 'mastered' },
  tapHint: {
    uk: 'Торкніться ноти — почуєте її й побачите клавішу. Торкніться клавіші — побачите її на нотному стані.',
    en: 'Tap a note to hear it and see its key. Tap a key to see it on the staff.',
  },
  noNotes: { uk: 'У цьому фрагменті немає нот.', en: 'This fragment has no notes.' },
} as const;

export type SheetString = keyof typeof S;

export function s(lang: Lang, key: SheetString): string {
  return S[key][lang];
}
