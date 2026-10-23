import type { FragmentProgress, Lesson, LessonSummary, ProgressStatus } from '@piano-steps/core';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api.ts';
import { LessonPlayer } from './audio/player.ts';
import type { DevShell } from './devtools/shell.ts';
import { t } from './i18n.ts';
import { NoteInput } from './input/noteInput.ts';
import { useSettings, useTheme } from './settings.ts';
import { FeedbackDialog } from './ui/FeedbackDialog.tsx';
import { SourcePlayer, hasOriginal } from './ui/SourcePlayer.tsx';
import { VARIANTS } from './variants/index.ts';
import './App.css';

const LAST_KEY = 'piano-steps-last';

function readLast(): { lesson?: string; ui?: string } {
  const q = new URLSearchParams(location.search);
  let stored: { lesson?: string; ui?: string } = {};
  try {
    stored = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}');
  } catch {
    /* ignore */
  }
  return { lesson: q.get('lesson') ?? stored.lesson, ui: q.get('ui') ?? stored.ui };
}

export default function App() {
  const [settings, updateSettings] = useSettings();
  const [theme, cycleTheme] = useTheme();
  const lang = settings.lang;
  const player = useMemo(() => new LessonPlayer(), []);
  const input = useMemo(() => new NoteInput(), []);

  const initial = useRef(readLast());
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [lessonRef, setLessonRef] = useState<string | undefined>(initial.current.lesson);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [variantId, setVariantId] = useState(
    VARIANTS.some((v) => v.id === initial.current.ui) ? initial.current.ui! : VARIANTS[0].id,
  );
  const [progress, setProgress] = useState<FragmentProgress[]>([]);
  const [fragmentPos, setFragmentPos] = useState<number | null>(null);
  const [dialog, setDialog] = useState<null | 'feedback' | 'original' | 'settings'>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<api.Health | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // iOS/iPadOS only allow audio after a user gesture: unlock on the first touch anywhere.
  useEffect(() => {
    const unlock = () => void player.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    const detach = input.attachComputerKeyboard();
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      detach();
    };
  }, [player, input]);

  // `auth: true` → the server wants a token for writes; Settings then shows the token field.
  useEffect(() => {
    api.getHealth().then(setHealth, () => setHealth(null));
  }, []);

  const refreshList = useCallback(async () => {
    const list = await api.listLessons();
    setLessons(list);
    return list;
  }, []);

  useEffect(() => {
    refreshList()
      .then((list) => {
        if (!list.length) return;
        if (!lessonRef || !list.some((l) => l.slug === lessonRef || l.id === lessonRef)) setLessonRef(list[0].slug);
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!lessonRef) return;
    let cancelled = false;
    setLesson(null);
    api
      .getLesson(lessonRef)
      .then(async (l) => {
        if (cancelled) return;
        player.load(l.notes);
        setLesson(l);
        setFragmentPos(null);
        setProgress(await api.getProgress(l.slug).catch(() => []));
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [lessonRef, player]);

  // Remember + reflect the selection in the URL (shareable, survives reload).
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (lessonRef) q.set('lesson', lessonRef);
    q.set('ui', variantId);
    history.replaceState(null, '', `${location.pathname}?${q}`);
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ lesson: lessonRef, ui: variantId }));
    } catch {
      /* ignore */
    }
  }, [lessonRef, variantId]);

  const recordProgress = useCallback(
    (p: { fragmentPosition: number; status?: ProgressStatus; attempt?: boolean }) => {
      if (!lesson) return;
      api.recordProgress(lesson.slug, p).then(setProgress).catch(() => {});
    },
    [lesson],
  );
  const onFragmentChange = useCallback((p: number | null) => setFragmentPos(p), []);

  const onImport = async (file: File) => {
    try {
      const name = file.name.toLowerCase();
      const l = name.endsWith('.json')
        ? await api.createLesson(JSON.parse(await file.text()), { upsert: true })
        : /\.(musicxml|xml|mxl)$/.test(name)
          ? await api.importMusicXml(file)
          : await api.importMidi(file, file.name.replace(/\.(mid|midi)$/i, ''));
      await refreshList();
      setLessonRef(l.slug);
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 401) return setError(t(lang, 'needToken'));
      const details = e instanceof api.ApiError && e.details && e.message === 'validation' ? `\n${e.details.join('\n')}` : '';
      setError(`${e instanceof Error ? e.message : String(e)}${details}`);
    }
  };

  const variant = VARIANTS.find((v) => v.id === variantId) ?? VARIANTS[0];
  const Variant = variant.component;
  const frag = lesson && fragmentPos !== null ? lesson.fragments[fragmentPos] ?? null : null;
  const fragTitle = frag ? `${t(lang, 'fragment')} ${frag.title ?? `#${(fragmentPos ?? 0) + 1}`}` : t(lang, 'wholeLesson');
  const variantKey = lesson ? `${variant.id}:${lesson.id}:${lesson.updatedAt}` : '';

  // State a variant publishes for tests/agents (VariantProps.reportState), remembered per mounted variant.
  const variantState = useRef<{ key: string; state: Record<string, unknown> } | null>(null);
  const reportState = useCallback(
    (state: Record<string, unknown>) => {
      variantState.current = { key: variantKey, state };
    },
    [variantKey],
  );

  // Dev automation API — window.pianoSteps + WebMCP tools (docs/testing-api.md). The dynamic import
  // inside `import.meta.env.DEV` keeps it out of production builds entirely.
  const devShell = useRef<DevShell | null>(null);
  devShell.current = {
    lessons,
    lesson,
    lessonRef,
    variantId,
    variantIds: VARIANTS.map((v) => v.id),
    fragmentPos,
    dialog,
    error,
    offline: api.isOffline(),
    settings,
    player,
    input,
    variantState: () => (variantState.current?.key === variantKey ? variantState.current.state : null),
    selectLesson: setLessonRef,
    setVariant: (id) => {
      player.stop();
      setVariantId(id);
    },
    refreshLessons: refreshList,
  };
  useEffect(() => {
    if (import.meta.env.DEV) {
      let off: (() => void) | undefined;
      let live = true;
      void import('./devtools/index.ts').then((m) => {
        if (live) off = m.installDevtools(() => devShell.current!);
      });
      return () => {
        live = false;
        off?.();
      };
    }
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">🎹 {t(lang, 'appName')}</span>
        <select
          aria-label={t(lang, 'lesson')}
          value={lessonRef ?? ''}
          onChange={(e) => setLessonRef(e.target.value)}
        >
          {lessons.map((l) => (
            <option key={l.id} value={l.slug}>
              {l.title}
              {l.artist || l.composer ? ` — ${l.artist ?? l.composer}` : ''}
            </option>
          ))}
        </select>
        <div className="seg" role="tablist" aria-label={t(lang, 'variant')}>
          {VARIANTS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-pressed={v.id === variantId}
              title={v.blurb[lang]}
              onClick={() => {
                player.stop();
                setVariantId(v.id);
              }}
            >
              {v.name[lang]}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button className="btn ghost" onClick={() => fileRef.current?.click()} title={t(lang, 'importHint')}>
          ⤒ {t(lang, 'importLesson')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".mid,.midi,.json,.musicxml,.xml,.mxl,audio/midi,application/json,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
            e.target.value = '';
          }}
        />
        <button className="btn ghost" aria-label={t(lang, 'settings')} onClick={() => setDialog('settings')}>
          ⚙
        </button>
      </header>

      <main className="stage">
        {api.isOffline() && <div className="banner">{t(lang, 'offline')}</div>}
        {error && (
          <div className="banner" style={{ color: 'var(--bad)', whiteSpace: 'pre-wrap' }} onClick={() => setError(null)}>
            {t(lang, 'error')}: {error}
          </div>
        )}
        {lesson && (
          <div className="fab">
            {hasOriginal(lesson) && (
              <button className="btn" onClick={() => setDialog('original')}>
                🎧 {t(lang, 'hearOriginal')}
              </button>
            )}
            {!api.isOffline() && (
              <button className="btn" onClick={() => setDialog('feedback')}>
                ⚑ {t(lang, 'soundsWrong')}
              </button>
            )}
          </div>
        )}
        {lesson ? (
          <Suspense fallback={<p data-loading style={{ padding: 16 }}>{t(lang, 'loading')}</p>}>
            <Variant
              key={variantKey}
              lesson={lesson}
              player={player}
              input={input}
              settings={settings}
              lang={lang}
              progress={progress}
              recordProgress={recordProgress}
              onFragmentChange={onFragmentChange}
              reportState={reportState}
            />
          </Suspense>
        ) : (
          <p data-loading style={{ padding: 16 }} className="muted">
            {t(lang, 'loading')}
          </p>
        )}
      </main>

      {dialog === 'feedback' && lesson && (
        <FeedbackDialog
          lessonRef={lesson.slug}
          fragmentPosition={fragmentPos}
          fragmentTitle={`${lesson.title} · ${fragTitle}`}
          lang={lang}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'original' && lesson && (
        <SourcePlayer lesson={lesson} fragment={frag} onClose={() => setDialog(null)} closeLabel={t(lang, 'close')} />
      )}
      {dialog === 'settings' && (
        <div className="sheet-backdrop" onClick={() => setDialog(null)}>
          <div className="sheet card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16 }}>{t(lang, 'settings')}</h3>
            <div className="settings-grid">
              <span>{t(lang, 'noteNames')}</span>
              <div className="seg">
                <button aria-pressed={settings.noteNames === 'letter'} onClick={() => updateSettings({ noteNames: 'letter' })}>
                  {t(lang, 'letters')}
                </button>
                <button aria-pressed={settings.noteNames === 'solfege'} onClick={() => updateSettings({ noteNames: 'solfege' })}>
                  {t(lang, 'solfege')}
                </button>
              </div>
              <span>{t(lang, 'keyLabels')}</span>
              <div className="seg">
                {(['all', 'c', 'none'] as const).map((k) => (
                  <button key={k} aria-pressed={settings.keyLabels === k} onClick={() => updateSettings({ keyLabels: k })}>
                    {t(lang, k === 'all' ? 'labelsAll' : k === 'c' ? 'labelsC' : 'labelsNone')}
                  </button>
                ))}
              </div>
              <span>{t(lang, 'language')}</span>
              <div className="seg">
                <button aria-pressed={lang === 'uk'} onClick={() => updateSettings({ lang: 'uk' })}>UA</button>
                <button aria-pressed={lang === 'en'} onClick={() => updateSettings({ lang: 'en' })}>EN</button>
              </div>
              <span>{t(lang, 'theme')}</span>
              <div>
                <button className="btn" onClick={cycleTheme}>
                  {t(lang, theme === 'system' ? 'themeSystem' : theme === 'light' ? 'themeLight' : 'themeDark')}
                </button>
              </div>
              {health?.auth && (
                <>
                  <span>{t(lang, 'apiToken')}</span>
                  <div>
                    <input
                      type="password"
                      autoComplete="off"
                      aria-label={t(lang, 'apiToken')}
                      defaultValue={api.getApiToken() ?? ''}
                      onChange={(e) => api.setApiToken(e.target.value.trim() || null)}
                      style={{ width: '100%', minHeight: 'var(--tap)', padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--bd)', background: 'var(--bg)' }}
                    />
                    <p className="muted" style={{ margin: '4px 0 0' }}>{t(lang, 'apiTokenHint')}</p>
                  </div>
                </>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn" onClick={() => setDialog(null)}>
                {t(lang, 'close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
