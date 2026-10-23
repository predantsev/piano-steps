import type { Lang } from '../../settings.ts';

/** Strings of the "cards" variant (kept here so parallel work never collides on i18n.ts). */
const S = {
  step: { uk: 'Крок', en: 'Step' },
  of: { uk: 'з', en: 'of' },
  press: { uk: 'Натисніть', en: 'Press' },
  pressTogether: { uk: 'Натисніть разом', en: 'Press together' },
  bothTogether: { uk: 'Разом', en: 'Together' },
  right: { uk: 'права', en: 'right' },
  left: { uk: 'ліва', en: 'left' },
  keepHolding: { uk: 'тримайте', en: 'keep holding' },
  laneRight: { uk: 'Права', en: 'Right' },
  laneLeft: { uk: 'Ліва', en: 'Left' },
  back: { uk: 'Назад', en: 'Back' },
  next: { uk: 'Далі', en: 'Next' },
  playStep: { uk: 'Крок', en: 'Step' },
  playStepHint: { uk: 'Послухати цей крок', en: 'Listen to this step' },
  playFragment: { uk: 'Фрагмент', en: 'Fragment' },
  playFragmentHint: { uk: 'Послухати весь фрагмент', en: 'Listen to the whole fragment' },
  stop: { uk: 'Стоп', en: 'Stop' },
  loop: { uk: 'Повтор', en: 'Loop' },
  loopHint: { uk: 'Повторювати фрагмент по колу', en: 'Repeat the fragment over and over' },
  speed: { uk: 'Темп', en: 'Speed' },
  fragment: { uk: 'Фрагмент', en: 'Fragment' },
  fragments: { uk: 'Фрагменти', en: 'Fragments' },
  prevFragment: { uk: 'Фрагмент', en: 'Fragment' },
  nextFragment: { uk: 'Фрагмент', en: 'Fragment' },
  prevFragmentHint: { uk: 'Попередній фрагмент', en: 'Previous fragment' },
  nextFragmentHint: { uk: 'Наступний фрагмент', en: 'Next fragment' },
  statusNew: { uk: 'нове', en: 'new' },
  statusLearning: { uk: 'вчу', en: 'learning' },
  statusMastered: { uk: 'вивчено', en: 'learned' },
  learned: { uk: 'вивчено', en: 'learned' },
  doneTitle: { uk: 'Фрагмент пройдено', en: 'Fragment done' },
  doneAsk: { uk: 'Вийшло зіграти на піаніно?', en: 'Did it work on the piano?' },
  again: { uk: 'Ще раз', en: 'Again' },
  gotIt: { uk: 'Вийшло → наступний', en: 'Got it → next fragment' },
  gotItLast: { uk: 'Вийшло', en: 'Got it' },
  allDoneTitle: { uk: 'Усі фрагменти пройдено', en: 'All fragments done' },
  allDoneText: { uk: 'Можна зіграти весь урок або почати спочатку.', en: 'Play the whole piece, or start over.' },
  fromStart: { uk: 'З першого фрагмента', en: 'From the first fragment' },
  emptyFragment: { uk: 'У цьому фрагменті немає нот.', en: 'This fragment has no notes.' },
  noFragments: { uk: 'В уроці немає фрагментів.', en: 'This lesson has no fragments.' },
  navHint: { uk: 'свайп · ← → · пробіл', en: 'swipe · ← → · Space' },
  stepsStrip: { uk: 'Кроки фрагмента', en: 'Steps of the fragment' },
} satisfies Record<string, Record<Lang, string>>;

export type CardsKey = keyof typeof S;

export function tr(lang: Lang, key: CardsKey): string {
  return S[key][lang];
}
