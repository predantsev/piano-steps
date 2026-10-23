import type { Lang } from '../../settings.ts';

/** Strings of the falling-notes variant (kept here so parallel work never collides on i18n.ts). */
const STRINGS = {
  fragments: { uk: 'Фрагменти', en: 'Fragments' },
  wholeLesson: { uk: 'Увесь урок', en: 'Whole lesson' },
  play: { uk: 'Грати', en: 'Play' },
  resume: { uk: 'Продовжити', en: 'Resume' },
  pause: { uk: 'Пауза', en: 'Pause' },
  next: { uk: 'Далі', en: 'Next' },
  again: { uk: 'Ще раз', en: 'Again' },
  restart: { uk: 'З початку', en: 'From the start' },
  hearStep: { uk: 'Послухати', en: 'Hear it' },
  loop: { uk: 'Повтор', en: 'Loop' },
  wait: { uk: 'Чекати мене', en: 'Wait for me' },
  sound: { uk: 'Звук', en: 'Sound' },
  speed: { uk: 'Швидкість', en: 'Speed' },
  hands: { uk: 'Руки', en: 'Hands' },
  both: { uk: 'Обидві', en: 'Both' },
  right: { uk: 'Права', en: 'Right' },
  left: { uk: 'Ліва', en: 'Left' },
  lookAhead: { uk: 'Видно наперед', en: 'Look-ahead' },
  gotIt: { uk: 'Вивчив', en: 'Got it' },
  mastered: { uk: 'Вивчено', en: 'Learned' },
  runs: { uk: 'проходів', en: 'runs' },
  playThese: { uk: 'Зіграй', en: 'Play' },
  spaceHint: { uk: '· пробіл = «Далі»', en: '· Space = Next' },
  nextFragment: { uk: 'Наступний', en: 'Next' },
  fragmentDone: { uk: 'Фрагмент пройдено', en: 'Fragment done' },
  emptyFragment: { uk: 'У цьому фрагменті немає нот', en: 'This fragment has no notes' },
  ahead: { uk: 'Наперед', en: 'Ahead' },
  sec: { uk: 'с', en: 's' },
  noNotes: { uk: 'У цьому фрагменті немає нот для цієї руки', en: 'No notes for this hand in this fragment' },
  tapBar: { uk: 'Торкніться смужки, щоб почути ноту', en: 'Tap a bar to hear its note' },
  getReady: { uk: 'Готуйся…', en: 'Get ready…' },
} as const;

export type StringKey = keyof typeof STRINGS;

export function s(lang: Lang, key: StringKey): string {
  return STRINGS[key][lang];
}
