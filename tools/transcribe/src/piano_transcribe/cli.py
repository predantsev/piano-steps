"""`transcribe` — turn a recording into a piano-steps lesson, through the app's public API.

  transcribe youtube <url> [--start S --end S] [--title T]
  transcribe audio <file> [--source-url URL]
  transcribe midi <file>
  transcribe fix <lesson-slug> <fragment> [--engine E] [--onset-threshold X] [--feedback ID]
  transcribe feedback                      # the open "sounds wrong" queue
  transcribe show <lesson-slug> [fragment] # the notes as text, step by step
  transcribe eval <url-or-file> --reference fur-elise-opening   # accuracy vs a known lesson

Env: PIANO_STEPS_URL (default http://127.0.0.1:9300), PIANO_STEPS_API_TOKEN,
PIANO_STEPS_WEB_URL (when the web app is on another origin), TRANSCRIBE_WORK, TRANSCRIBE_MODELS.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import engines
from .api import Api, ApiError
from .audio import Source, crop, fetch_youtube, load_local, youtube_id
from .cleanup import CleanupOptions
from .hands import HandOptions, assign_hands
from .lesson import build_lesson, from_lesson_notes, to_lesson_notes, zero_at_first_note
from .midi_io import read_midi, write_midi
from .notes import Note, group_steps, in_window, pitch_name, shift
from .pipeline import PipelineOptions, postprocess, run, source_note


def _pipeline_args(p: argparse.ArgumentParser) -> None:
    g = p.add_argument_group("transcription")
    g.add_argument("--engine", choices=engines.ENGINES, default=engines.DEFAULT_ENGINE)
    g.add_argument("--onset-threshold", type=float, help="engine onset threshold (lower = more notes)")
    g.add_argument("--frame-threshold", type=float, help="engine frame threshold")
    c = p.add_argument_group("cleanup")
    d = CleanupOptions()
    c.add_argument("--no-cleanup", action="store_true", help="keep the raw engine output")
    c.add_argument("--min-velocity", type=float, default=d.min_velocity)
    c.add_argument("--min-duration", type=float, default=d.min_duration)
    c.add_argument("--retrigger", type=float, default=d.retrigger_window, help="merge same-pitch onsets closer than this (s)")
    c.add_argument("--harmonic-ratio", type=float, default=d.harmonic_ratio, help="drop overtone ghosts quieter than this × the fundamental (0 = off)")
    c.add_argument("--quantize", action="store_true", help="snap onsets to a beat-tracked sixteenth grid")
    h = p.add_argument_group("hands")
    h.add_argument("--hands", choices=("auto", "fixed"), default="auto")
    h.add_argument("--split", type=int, default=60, help="fixed split pitch / prior for auto (60 = C4 → right hand)")


def _pipeline_options(a: argparse.Namespace) -> PipelineOptions:
    return PipelineOptions(
        engine=a.engine,
        engine_opts=engines.EngineOptions(a.onset_threshold, a.frame_threshold),
        cleanup=None
        if a.no_cleanup
        else CleanupOptions(
            min_velocity=a.min_velocity,
            min_duration=a.min_duration,
            retrigger_window=a.retrigger,
            harmonic_ratio=a.harmonic_ratio,
        ),
        hands=a.hands,
        hand_opts=HandOptions(split=a.split - 0.5),
        split_pitch=a.split,
        quantize=a.quantize,
    )


def _output_args(p: argparse.ArgumentParser) -> None:
    g = p.add_argument_group("lesson")
    g.add_argument("--title")
    g.add_argument("--slug")
    g.add_argument("--composer")
    g.add_argument("--artist")
    g.add_argument("--replace", action="store_true", help="replace an existing lesson with the same slug (upsert)")
    g.add_argument("--dry-run", action="store_true", help="do not upload; print a summary (use --save-json)")
    g.add_argument("--save-json", type=Path, help="also write the lesson JSON here")
    g.add_argument("--save-midi", type=Path, help="also write a two-track MIDI here")


def _window_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--start", type=float, default=0.0, help="seconds into the recording")
    p.add_argument("--end", type=float, help="seconds into the recording")


# ── commands ──────────────────────────────────────────────────────────────


def _transcribe_source(src: Source, a: argparse.Namespace, kind: str) -> int:
    opts = _pipeline_options(a)
    clip = src.wav
    if a.start or a.end is not None:
        tag = f"clip-{a.start:g}-{'end' if a.end is None else f'{a.end:g}'}"
        clip = crop(src.wav, a.start, a.end, src.cache_dir / f"{tag}.wav")
    notes = run(clip, opts)
    if not notes:
        print("no notes found — is there piano in this window?", file=sys.stderr)
        return 1
    notes, t0 = zero_at_first_note(notes)
    offset = a.start + t0
    lesson = build_lesson(
        notes,
        title=a.title or src.title or "Transcription",
        kind=kind,
        url=src.url,
        offset_sec=offset,
        note=source_note(opts, f"Lesson time 0 = {offset:.2f} s into the recording"),
        slug=a.slug,
        composer=a.composer,
        artist=a.artist,
    )
    return _emit(lesson, notes, a)


def _emit(lesson: dict, notes: list[Note], a: argparse.Namespace) -> int:
    if a.save_json:
        a.save_json.parent.mkdir(parents=True, exist_ok=True)
        a.save_json.write_text(json.dumps(lesson, indent=1, ensure_ascii=False))
        print(f"wrote {a.save_json}", file=sys.stderr)
    if a.save_midi:
        write_midi(notes, a.save_midi)
        print(f"wrote {a.save_midi}", file=sys.stderr)
    hands = {h: sum(1 for n in notes if n.hand == h) for h in ("R", "L")}
    dur = max(n.end for n in notes)
    print(f"{len(notes)} notes (R {hands['R']}, L {hands['L']}), {dur:.1f} s", file=sys.stderr)
    if a.dry_run:
        return 0
    api = Api(a.base, a.token)
    try:
        created = api.create_lesson(lesson, upsert=a.replace)
    except ApiError as e:
        if e.status == 409:
            print(f"a lesson with this slug exists — pass --replace to overwrite it, or --slug to pick another ({e})", file=sys.stderr)
            return 2
        raise
    print(f"lesson '{created['slug']}': {len(created['notes'])} notes, {len(created['fragments'])} fragments, "
          f"offsetSec={created.get('source', {}).get('offsetSec')}", file=sys.stderr)
    print(api.web_url(created["slug"]))
    return 0


def cmd_youtube(a: argparse.Namespace) -> int:
    return _transcribe_source(fetch_youtube(a.url), a, "transcription-audio")


def cmd_audio(a: argparse.Namespace) -> int:
    src = load_local(a.file, a.source_url)
    return _transcribe_source(src, a, "transcription-audio")


def cmd_midi(a: argparse.Namespace) -> int:
    notes, hands_known = read_midi(a.file)
    if not notes:
        print("no notes in this MIDI file", file=sys.stderr)
        return 1
    if not hands_known or a.hands_from_pitch:
        notes = assign_hands(notes, HandOptions(split=a.split - 0.5))
    notes, t0 = zero_at_first_note(notes)
    lesson = build_lesson(
        notes,
        title=a.title or a.file.stem,
        kind="midi",
        url=a.source_url,
        offset_sec=(a.offset + t0) if a.source_url else None,
        note=f"Imported from {a.file.name} by tools/transcribe"
        + ("; hands from the two tracks" if hands_known and not a.hands_from_pitch else "; hands by beam search"),
        slug=a.slug,
        composer=a.composer,
        artist=a.artist,
    )
    return _emit(lesson, notes, a)


def _source_audio(lesson: dict) -> Source:
    url = (lesson.get("source") or {}).get("url")
    if youtube_id(url):
        return fetch_youtube(url)
    if url and (url.startswith("file://") or Path(url).exists()):
        return load_local(Path(url.removeprefix("file://")), url)
    raise RuntimeError(f"lesson has no re-playable source (source.url = {url!r}); fix needs the recording")


def cmd_fix(a: argparse.Namespace) -> int:
    api = Api(a.base, a.token)
    if a.feedback and not a.dry_run:
        api.update_feedback(a.feedback, status="in-progress")
    lesson = api.get_lesson(a.lesson)
    frags = lesson["fragments"]
    if not 0 <= a.fragment < len(frags):
        print(f"fragment {a.fragment} not in 0…{len(frags) - 1}", file=sys.stderr)
        return 2
    fr = frags[a.fragment]
    offset = float((lesson.get("source") or {}).get("offsetSec") or 0.0)
    src = _source_audio(lesson)
    # re-transcribe a padded window for context, keep only onsets inside the fragment: the API
    # deletes exactly the notes whose onset is in [start, end) and inserts ours.
    v0 = max(offset + fr["start"] - a.pad, 0.0)
    v1 = offset + fr["end"] + a.pad
    clip = crop(src.wav, v0, v1, src.cache_dir / f"fix-{lesson['slug']}-{a.fragment}.wav")
    opts = _pipeline_options(a)
    notes = shift(run(clip, opts), v0 - offset)  # clip time → lesson time
    new = in_window(notes, fr["start"], fr["end"])
    old = in_window(from_lesson_notes(lesson["notes"]), fr["start"], fr["end"])
    print(f"fragment {a.fragment} [{fr['start']:.2f}, {fr['end']:.2f}) s:", file=sys.stderr)
    print(f"  before ({len(old)}): {_steps_text(old)}", file=sys.stderr)
    print(f"  after  ({len(new)}): {_steps_text(new)}", file=sys.stderr)
    if a.dry_run:
        return 0
    updated = api.replace_fragment_notes(lesson["slug"], a.fragment, to_lesson_notes(new))
    print(f"updated '{updated['slug']}': {len(updated['notes'])} notes", file=sys.stderr)
    if a.feedback:
        resolution = a.resolution or f"re-transcribed fragment {a.fragment} with {engines.describe(opts.engine, opts.engine_opts)}: {len(old)} → {len(new)} notes"
        api.update_feedback(a.feedback, status="resolved", resolution=resolution)
        print(f"feedback {a.feedback} resolved", file=sys.stderr)
    print(api.web_url(updated["slug"]))
    return 0


def cmd_feedback(a: argparse.Namespace) -> int:
    items = Api(a.base, a.token).list_feedback(None if a.status == "all" else a.status, a.lesson)
    if a.json:
        print(json.dumps(items, indent=1, ensure_ascii=False))
        return 0
    if not items:
        print(f"no {a.status} feedback")
    for f in items:
        frag = f.get("fragmentPosition")
        print(f"{f['id']}  {f.get('lessonSlug')}  fragment {'-' if frag is None else frag}  [{f['status']}]  {f['message']}")
    return 0


def _steps_text(notes: list[Note]) -> str:
    def step(s: list[Note]) -> str:
        return "+".join(f"{pitch_name(n.pitch)}{'' if not n.hand else n.hand.lower()}" for n in s)

    return " ".join(step(s) for s in group_steps(notes)) or "(none)"


def cmd_show(a: argparse.Namespace) -> int:
    lesson = Api(a.base, a.token).get_lesson(a.lesson)
    notes = from_lesson_notes(lesson["notes"])
    src = lesson.get("source") or {}
    print(f"{lesson['title']} · {len(notes)} notes · source {src.get('kind')} {src.get('url', '')} offset {src.get('offsetSec')}")
    for i, fr in enumerate(lesson["fragments"]):
        if a.fragment is not None and i != a.fragment:
            continue
        inside = in_window(notes, fr["start"], fr["end"])
        print(f"#{i} {fr.get('title', '')} [{fr['start']:.2f}, {fr['end']:.2f}) s, {len(inside)} notes: {_steps_text(inside)}")
    return 0


def cmd_eval(a: argparse.Namespace) -> int:
    from .evaluate import main as eval_main

    return eval_main(a)


# ── parser ────────────────────────────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="transcribe", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base", help="app base URL (default $PIANO_STEPS_URL or http://127.0.0.1:9300)")
    p.add_argument("--token", help="API token (default $PIANO_STEPS_API_TOKEN)")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("youtube", help="YouTube URL → lesson")
    s.add_argument("url")
    _window_args(s)
    _pipeline_args(s)
    _output_args(s)
    s.set_defaults(func=cmd_youtube)

    s = sub.add_parser("audio", help="local audio/video file → lesson")
    s.add_argument("file", type=Path)
    s.add_argument("--source-url", help="where the recording is published (enables 'hear the original' for YouTube)")
    _window_args(s)
    _pipeline_args(s)
    _output_args(s)
    s.set_defaults(func=cmd_audio)

    s = sub.add_parser("midi", help="MIDI file → lesson")
    s.add_argument("file", type=Path)
    s.add_argument("--source-url")
    s.add_argument("--offset", type=float, default=0.0, help="seconds into source-url where the MIDI's time 0 is")
    s.add_argument("--split", type=int, default=60)
    s.add_argument("--hands-from-pitch", action="store_true", help="ignore the tracks; assign hands by the beam search")
    _output_args(s)
    s.set_defaults(func=cmd_midi)

    s = sub.add_parser("fix", help="re-transcribe one fragment and replace its notes")
    s.add_argument("lesson", help="lesson slug or id")
    s.add_argument("fragment", type=int, help="fragment position (0-based, as in the API)")
    s.add_argument("--pad", type=float, default=1.0, help="context seconds transcribed around the fragment")
    s.add_argument("--feedback", help="feedback id: marked in-progress, then resolved")
    s.add_argument("--resolution", help="resolution text for --feedback")
    s.add_argument("--dry-run", action="store_true", help="show before/after, do not write")
    _pipeline_args(s)
    s.set_defaults(func=cmd_fix)

    s = sub.add_parser("feedback", help="list feedback (default: the open queue)")
    s.add_argument("--status", default="open", choices=("open", "in-progress", "resolved", "wont-fix", "all"))
    s.add_argument("--lesson")
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_feedback)

    s = sub.add_parser("show", help="print a lesson's fragments as note names")
    s.add_argument("lesson")
    s.add_argument("fragment", type=int, nargs="?")
    s.set_defaults(func=cmd_show)

    s = sub.add_parser("eval", help="accuracy of each engine against a reference lesson")
    s.add_argument("recording", help="YouTube URL or audio file")
    s.add_argument("--reference", default="fur-elise-opening", help="reference lesson slug (fetched from the API)")
    s.add_argument("--engines", default=",".join(engines.ENGINES))
    s.add_argument("--search-sec", type=float, default=60.0, help="look for the reference within the first N s")
    s.add_argument("--json-out", type=Path, help="write all numbers here")
    s.set_defaults(func=cmd_eval)
    return p


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    try:
        return a.func(a)
    except ApiError as e:
        print(f"API error: {e}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
