import type { Fragment, Lesson } from '@piano-steps/core';

/** YouTube id from the usual URL shapes (watch?v=, youtu.be/, /shorts/, /embed/). */
export function youtubeId(url: string | undefined): string | null {
  if (!url) return null;
  const m =
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url);
  return m ? m[1] : null;
}

/** Can the shell offer "hear the original" for this lesson? */
export function hasOriginal(lesson: Lesson): boolean {
  return youtubeId(lesson.source?.url) !== null;
}

/**
 * Plays the source recording for the current fragment (or the whole lesson):
 * lesson time t ↔ video time t + source.offsetSec.
 */
export function SourcePlayer({ lesson, fragment, onClose, closeLabel }: {
  lesson: Lesson;
  fragment: Fragment | null;
  onClose: () => void;
  closeLabel: string;
}) {
  const id = youtubeId(lesson.source?.url);
  if (!id) return null;
  const offset = lesson.source?.offsetSec ?? 0;
  const start = Math.max(0, Math.floor((fragment?.start ?? 0) + offset));
  const end = fragment ? Math.ceil(fragment.end + offset) + 1 : undefined;
  const src =
    `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&start=${start}` +
    (end ? `&end=${end}` : '');
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet card" onClick={(e) => e.stopPropagation()}>
        <div className="video">
          <iframe
            key={src}
            src={src}
            title="Original recording"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
