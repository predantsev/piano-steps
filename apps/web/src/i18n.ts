import type { Lang } from './settings.ts';

/**
 * Shell strings. Variants keep their own strings next to their code (variants/<id>/strings.ts)
 * so parallel work never collides on this file.
 */
const STRINGS = {
  appName: { uk: 'Piano Steps', en: 'Piano Steps' },
  lesson: { uk: 'Урок', en: 'Lesson' },
  variant: { uk: 'Вигляд', en: 'View' },
  settings: { uk: 'Налаштування', en: 'Settings' },
  noteNames: { uk: 'Назви нот', en: 'Note names' },
  letters: { uk: 'C D E', en: 'C D E' },
  solfege: { uk: 'До Ре Мі', en: 'Do Re Mi' },
  keyLabels: { uk: 'Підписи на клавішах', en: 'Labels on keys' },
  labelsAll: { uk: 'Усі', en: 'All' },
  labelsC: { uk: 'Тільки C', en: 'C only' },
  labelsNone: { uk: 'Без', en: 'None' },
  language: { uk: 'Мова', en: 'Language' },
  theme: { uk: 'Тема', en: 'Theme' },
  themeSystem: { uk: 'Авто', en: 'Auto' },
  themeLight: { uk: 'Світла', en: 'Light' },
  themeDark: { uk: 'Темна', en: 'Dark' },
  importLesson: { uk: 'Імпорт', en: 'Import' },
  importHint: {
    uk: 'Файл .mid, .musicxml / .mxl або .json (формат уроку)',
    en: 'A .mid, .musicxml / .mxl or lesson .json file',
  },
  apiToken: { uk: 'API-токен', en: 'API token' },
  apiTokenHint: {
    uk: 'Сервер приймає зміни лише з токеном. Зберігається тільки на цьому пристрої.',
    en: 'The server accepts changes only with this token. Stored on this device only.',
  },
  apiTokenInvalid: {
    uk: 'Токен може містити лише латинські літери, цифри та символи — перевірте розкладку клавіатури',
    en: 'A token has only Latin letters, digits and symbols — check the keyboard layout',
  },
  needToken: {
    uk: 'Потрібен API-токен: додайте його в Налаштуваннях (⚙)',
    en: 'An API token is needed: add it in Settings (⚙)',
  },
  offline: { uk: 'Офлайн: сервер недоступний, показую демо-уроки', en: 'Offline: server unreachable, showing demo lessons' },
  tapForSound: { uk: 'Торкніться, щоб увімкнути звук', en: 'Tap to enable sound' },
  soundsWrong: { uk: 'Звучить не так', en: 'Sounds wrong' },
  feedbackTitle: { uk: 'Що не так у фрагменті?', en: 'What is wrong in this fragment?' },
  feedbackPlaceholder: {
    uk: 'Напр.: у другому такті має бути інша нота, звучить нижче',
    en: 'E.g. the second bar should be a different note, it sounds lower',
  },
  send: { uk: 'Надіслати', en: 'Send' },
  cancel: { uk: 'Скасувати', en: 'Cancel' },
  sent: { uk: 'Надіслано — агент виправить фрагмент', en: 'Sent — an agent will fix the fragment' },
  hearOriginal: { uk: 'Оригінал', en: 'Original' },
  close: { uk: 'Закрити', en: 'Close' },
  fragment: { uk: 'Фрагмент', en: 'Fragment' },
  wholeLesson: { uk: 'Увесь урок', en: 'Whole lesson' },
  loading: { uk: 'Завантаження…', en: 'Loading…' },
  error: { uk: 'Помилка', en: 'Error' },
} satisfies Record<string, Record<Lang, string>>;

export type StringKey = keyof typeof STRINGS;

export function t(lang: Lang, key: StringKey): string {
  return STRINGS[key][lang];
}

/** Helper for variants: pick from an inline { uk, en } pair. */
export function pick(lang: Lang, s: { uk: string; en: string }): string {
  return s[lang];
}
