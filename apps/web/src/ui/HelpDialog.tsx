import { useEffect } from 'react';
import type { Lang } from '../settings.ts';

/**
 * The in-app guide: how to use every part of the app, and what "Sounds wrong" really does.
 * Each section is a <details>, so the guide stays short on an iPad and opens where you need it.
 * Keep it in step with the UI: a renamed button or a new mode belongs here too.
 */

type Text = Record<Lang, string>;
interface Section {
  id: string;
  title: Text;
  /** Paragraphs; a line starting with "• " is drawn as a list item. */
  body: Record<Lang, string[]>;
}

const SECTIONS: Section[] = [
  {
    id: 'flow',
    title: { uk: 'Як це працює — коротко', en: 'How it works — in short' },
    body: {
      uk: [
        'Застосунок показує мелодію короткими фрагментами на клавіатурі: «натисни це, потім ці дві разом». Ви дивитесь, граєте на своєму справжньому піаніно й ідете далі. Ноти читати не треба.',
        '• Угорі оберіть урок (список) і вигляд: «Падаючі ноти», «Картки» або «Ноти + клавіші».',
        '• Оберіть фрагмент (кнопки #1, #2… або ‹ ›) — вчіть по одному.',
        '• Послухайте або подивіться фрагмент, зіграйте його на піаніно, натисніть «Далі».',
        '• Коли фрагмент виходить — позначте «Вивчив» (✓). Прогрес зберігається.',
        'Підключене піаніно не потрібне: перевірка «чи правильно зіграв» — тільки якщо ви натискаєте клавіші на екрані або на клавіатурі комп’ютера.',
      ],
      en: [
        'The app shows a melody as short fragments on a keyboard: "press this, then these two together". You watch, play it on your own real piano and go on. No sheet music to read.',
        '• At the top pick a lesson (the list) and a view: "Falling notes", "Cards" or "Sheet + keys".',
        '• Pick a fragment (#1, #2… or ‹ ›) — learn one at a time.',
        '• Hear or watch the fragment, play it on the piano, tap Next.',
        '• When a fragment works, mark it "Got it" (✓). Progress is saved.',
        'No connected piano is needed: a "did I play it right" check happens only if you press keys on the screen or on the computer keyboard.',
      ],
    },
  },
  {
    id: 'falling',
    title: { uk: 'Вигляд «Падаючі ноти»', en: 'View: Falling notes' },
    body: {
      uk: [
        'Ноти падають на клавіші, як у Synthesia. Смужка торкається клавіші саме тоді, коли нота звучить.',
        '• Велика кнопка внизу: «Грати» / «Пауза» / «Продовжити»; перед стартом — коротке «Готуйся…».',
        '• ⏮ «З початку», 🔁 «Повтор» (фрагмент іде по колу), 🔊/🔇 звук.',
        '• Швидкість 25–100 %. Почніть повільно.',
        '• Руки: «Обидві», «Ліва», «Права» — тренуйте одну руку, друга мовчить. Зелена — права, синя — ліва.',
        '• 👁 «Наперед»: скільки секунд нот видно заздалегідь (2 / 3 / 5).',
        '• Торкніться падаючої смужки — почуєте її ноту.',
        '• Угорі — фрагменти і «Увесь урок»; поруч ✓ «Вивчив».',
      ],
      en: [
        'Notes fall onto the keys, Synthesia-style. A bar touches its key exactly when the note sounds.',
        '• The big bottom button: Play / Pause / Resume; a short "Get ready…" before the start.',
        '• ⏮ From the start, 🔁 Loop (the fragment repeats), 🔊/🔇 sound.',
        '• Speed 25–100 %. Start slow.',
        '• Hands: Both, Left, Right — practise one hand, the other stays silent. Green is right, blue is left.',
        '• 👁 Ahead: how many seconds of notes you see in advance (2 / 3 / 5).',
        '• Tap a falling bar to hear its note.',
        '• At the top: the fragments and "Whole lesson"; next to them ✓ Got it.',
      ],
    },
  },
  {
    id: 'wait',
    title: { uk: '«Чекати мене» — і як іти далі без клавіатури', en: '"Wait for me" — and moving on without a keyboard' },
    body: {
      uk: [
        'У режимі ⏸ «Чекати мене» ноти зупиняються на лінії біля клавіш, і внизу написано, що зіграти («Зіграй E4 + G4»). Далі — коли ви готові. Три рівноцінні способи:',
        '• Натисніть велику кнопку «Далі ›» внизу екрана — це головний спосіб на iPad.',
        '• Натисніть правильні клавіші на екранній клавіатурі (для акорду — усі). Крок піде сам; неправильна клавіша блимне.',
        '• Пробіл на під’єднаній клавіатурі — те саме, що «Далі».',
        '🔊 «Послухати» поруч програє поточний крок.',
      ],
      en: [
        'In ⏸ Wait for me the notes stop on the line by the keys, and the bar says what to play ("Play E4 + G4"). You go on when ready — three equal ways:',
        '• Tap the big "Next ›" button at the bottom — the main way on an iPad.',
        '• Press the right keys on the on-screen keyboard (all of a chord). The step moves on by itself; a wrong key flashes.',
        '• Space on an attached keyboard does the same as Next.',
        '🔊 "Hear it" next to it plays the current step.',
      ],
    },
  },
  {
    id: 'cards',
    title: { uk: 'Вигляд «Картки»', en: 'View: Cards' },
    body: {
      uk: [
        'Крок за кроком: одна картка — одна дія («Натисни E4», «Натисни разом C4 + E4»).',
        '• «Далі ›» / «‹ Назад», або проведіть пальцем по смузі карток; торкніться картки — перейдете на неї й почуєте її.',
        '• ▶ «Крок» — почути крок, ▶ «Фрагмент» — весь фрагмент, ⟳ повтор, швидкість.',
        '• ♩ «Грати разом»: тихо, з метрономом і відліком такту — грайте під клік.',
        '• Кольори на клавіатурі: колір руки — натиснути зараз, смужки — тримати далі, кільце — наступний крок.',
        '• Правильні клавіші на екрані теж переводять на наступний крок.',
        '• В кінці фрагмента: «Ще раз», «Вийшло → наступний» або просто «Наступний фрагмент ›».',
      ],
      en: [
        'Step by step: one card, one action ("Press E4", "Press together C4 + E4").',
        '• Next › / ‹ Back, or swipe the card strip; tap a card to jump there and hear it.',
        '• ▶ Step to hear a step, ▶ Fragment for the whole fragment, ⟳ loop, speed.',
        '• ♩ Play along: silent, with a metronome and a one-bar count-in — play to the click.',
        '• Keyboard colours: hand colour = press now, stripes = keep holding, ring = next step.',
        '• Pressing the right keys on screen also moves to the next step.',
        '• At the end of a fragment: Again, "Got it → next fragment" or just "Next fragment ›".',
      ],
    },
  },
  {
    id: 'sheet',
    title: { uk: 'Вигляд «Ноти + клавіші»', en: 'View: Sheet + keys' },
    body: {
      uk: [
        'Нотний запис синхронно з клавіатурою — для тих, хто хоче потроху звикати до нот. Читати їх не обов’язково.',
        '• ♪ «Слухати»: ▶ / ■, ⟲ повтор. ⇥ «По кроках»: «‹ Назад» / «Далі ›» по одній ноті чи акорду.',
        '• Торкніться ноти на нотному стані — почуєте її і побачите клавішу.',
        '• Натисніть клавішу — побачите, де вона на нотному стані (крок від цього не рухається).',
        '• Перемикачі «Назви» (підписи під нотами) і «Руки» (кольори рук), темп, ✓ «Вивчено».',
      ],
      en: [
        'Notation in sync with the keyboard — for getting used to notes bit by bit. Reading them is optional.',
        '• ♪ Listen: ▶ / ■, ⟲ loop. ⇥ Steps: ‹ Back / Next › one note or chord at a time.',
        '• Tap a note on the staff to hear it and see its key.',
        '• Press a key to see where it sits on the staff (this does not move the step).',
        '• "Names" (labels under notes) and "Hands" (hand colours) toggles, speed, ✓ Got it.',
      ],
    },
  },
  {
    id: 'keys',
    title: { uk: 'Клавіатура й екранні клавіші', en: 'Keyboard and on-screen keys' },
    body: {
      uk: [
        '• Екранна клавіатура грає акорди кількома пальцями й глісандо — проведіть пальцем.',
        '• Пробіл = велика кнопка (грати/пауза або «Далі»). ← / → — фрагменти (у «Картках» і «Кроках» — назад / далі).',
        '• Клавіатура комп’ютера як піаніно: A W S E D F T G Y H U J K = від C4 до C5 (далі O L P ;). Z / X — октава нижче / вище.',
        'Підказка «пробіл = Далі» з’являється лише коли є миша чи трекпад; без неї пробіл однаково працює.',
      ],
      en: [
        '• The on-screen keyboard plays chords with several fingers and glissando — slide your finger.',
        '• Space = the big button (play/pause or Next). ← / → switch fragments (in Cards and Steps: back / next).',
        '• The computer keyboard as a piano: A W S E D F T G Y H U J K = C4 up to C5 (then O L P ;). Z / X — octave down / up.',
        'The "Space = Next" hint shows only with a mouse or trackpad; Space works without it too.',
      ],
    },
  },
  {
    id: 'sound',
    title: { uk: 'Звук на iPad', en: 'Sound on an iPad' },
    body: {
      uk: [
        'Браузер дозволяє звук лише після дотику, тому перший дотик до сторінки вмикає звук. Якщо бачите «Торкніться, щоб увімкнути звук» — торкніться.',
        'Застосунок грає навіть у беззвучному режимі iPad. Якщо тихо: перевірте гучність, кнопку 🔊 у вигляді і що вкладка не вимкнена; потім оновіть сторінку й торкніться екрана.',
        'Поки семпли рояля завантажуються з інтернету, перші ноти звучать простим синтезатором.',
      ],
      en: [
        'The browser allows sound only after a touch, so your first tap on the page turns it on. If you see "Tap to enable sound", tap.',
        'The app plays even with the iPad in silent mode. If it is quiet: check the volume, the 🔊 button in the view and that the tab is not muted; then reload and tap the screen.',
        'Until the grand-piano samples load from the internet, the first notes sound with a simple synth.',
      ],
    },
  },
  {
    id: 'lessons',
    title: { uk: 'Звідки беруться уроки', en: 'Where lessons come from' },
    body: {
      uk: [
        '• Агент (Claude Code) робить урок з відео YouTube, аудіо чи MIDI: скажіть йому «зроби урок з цього відео <посилання>» — він розпізнає ноти й завантажить урок через API.',
        '• ⤒ «Імпорт» — файл .mid / .midi, .musicxml / .xml / .mxl або .json у форматі уроку. Урок з’явиться у списку і відкриється.',
        '• 🎧 «Оригінал» — якщо урок зроблено з YouTube, відкриває відео саме з місця поточного фрагмента. Добре, щоб звірити на слух.',
        'Уроки зберігаються в базі на вашому комп’ютері, не в інтернеті.',
      ],
      en: [
        '• An agent (Claude Code) makes a lesson from a YouTube video, audio or MIDI: tell it "make a lesson from this video <link>" — it transcribes the notes and uploads the lesson through the API.',
        '• ⤒ Import — a .mid / .midi, .musicxml / .xml / .mxl or lesson .json file. The lesson appears in the list and opens.',
        '• 🎧 Original — when a lesson came from YouTube, opens the video right at the current fragment. Handy to compare by ear.',
        'Lessons live in the database on your computer, not on the internet.',
      ],
    },
  },
  {
    id: 'feedback',
    title: { uk: '«Звучить не так» — що це робить', en: '"Sounds wrong" — what it does' },
    body: {
      uk: [
        'Розпізнавання нот з відео не ідеальне. Якщо фрагмент звучить не так, як в оригіналі, натисніть ⚑ «Звучить не так» і опишіть словами, що не так («у другому такті має бути інша нота, нижча»). Скарга прив’язується до поточного фрагмента.',
        'Що відбувається далі — чесно:',
        '• Застосунок лише зберігає скаргу в чергу. Сам він урок не виправляє і скарг не показує.',
        '• Виправляє агент: скажіть Claude Code «перевір чергу скарг» (навичка /transcribe). Він перечитає фрагмент з оригіналу, замінить ноти саме цього фрагмента і позначить скаргу виправленою — або пояснить, чому не вийшло.',
        '• Без агента: можна виправити вручну — відкрити оригінал (🎧), підібрати правильні ноти і імпортувати виправлений урок; список скарг видно за адресою /api/feedback?status=open.',
        'Тож найкраще разом: ви на слух помічаєте помилку й описуєте її, агент виправляє. Чим конкретніше опис (який такт, вище/нижче, яка рука) — тим точніше виправлення.',
      ],
      en: [
        'Transcribing notes from a video is not perfect. If a fragment sounds unlike the original, tap ⚑ Sounds wrong and say in words what is off ("the second bar should be a different, lower note"). The report is tied to the current fragment.',
        'What happens next, honestly:',
        '• The app only stores the report in a queue. It does not fix the lesson itself and does not show the reports.',
        '• An agent fixes it: tell Claude Code "check the feedback queue" (the /transcribe skill). It re-transcribes that fragment from the original, replaces only that fragment\'s notes and marks the report resolved — or says why it could not.',
        '• Without an agent: fix it by hand — open the original (🎧), find the right notes and import a corrected lesson; the report list is at /api/feedback?status=open.',
        'So it works best together: you notice the mistake by ear and describe it, the agent fixes it. The more specific (which bar, higher/lower, which hand), the better the fix.',
      ],
    },
  },
  {
    id: 'settings',
    title: { uk: 'Налаштування (⚙)', en: 'Settings (⚙)' },
    body: {
      uk: [
        '• Назви нот: C D E або До Ре Мі. Підписи на клавішах: усі / тільки C / без.',
        '• Мова UA / EN, тема (Авто → Світла → Темна).',
        '• API-токен — тільки якщо сервер його вимагає: без нього не зберігаються імпорт, скарги і прогрес.',
        'Вибраний урок і вигляд запам’ятовуються, а посилання з адресного рядка відкриває саме їх. Якщо сервер недоступний — показуються демо-уроки.',
      ],
      en: [
        '• Note names: C D E or Do Re Mi. Labels on keys: all / C only / none.',
        '• Language UA / EN, theme (Auto → Light → Dark).',
        '• API token — only if the server asks for one: without it imports, reports and progress are not saved.',
        'The chosen lesson and view are remembered, and the address-bar link opens exactly them. If the server is unreachable, demo lessons are shown.',
      ],
    },
  },
];

export function HelpDialog({ lang, onClose }: { lang: Lang; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet card help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="help-title">{lang === 'uk' ? 'Як користуватися' : 'How to use it'}</h3>
        <div className="help-body">
          {SECTIONS.map((sec, i) => (
            <details key={sec.id} open={i === 0} data-help={sec.id}>
              <summary>{sec.title[lang]}</summary>
              {sec.body[lang].map((p, j) =>
                p.startsWith('• ') ? (
                  <p key={j} className="help-item">
                    {p.slice(2)}
                  </p>
                ) : (
                  <p key={j}>{p}</p>
                ),
              )}
            </details>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn" onClick={onClose}>
            {lang === 'uk' ? 'Закрити' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
