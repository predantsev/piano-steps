import numpy as np

from piano_transcribe.cleanup import (
    CleanupOptions,
    beat_grid,
    clean,
    drop_ghosts,
    drop_harmonics,
    drop_out_of_range,
    merge_retriggers,
    quantize,
)
from piano_transcribe.notes import Note, group_steps


def test_drop_ghosts_removes_quiet_and_tiny_notes():
    notes = [Note(60, 0, 0.5, 0.8), Note(61, 0.1, 0.5, 0.05), Note(62, 0.2, 0.01, 0.9)]
    assert [n.pitch for n in drop_ghosts(notes, min_velocity=0.1, min_duration=0.03)] == [60]


def test_out_of_range_pitches_are_dropped():
    assert [n.pitch for n in drop_out_of_range([Note(20, 0, 1), Note(21, 0, 1), Note(108, 0, 1), Note(109, 0, 1)])] == [21, 108]


def test_retrigger_within_window_is_merged_into_one_note():
    notes = [Note(64, 1.0, 0.03, 0.7), Note(64, 1.04, 0.4, 0.5)]
    out = merge_retriggers(notes, window=0.07)
    assert len(out) == 1
    assert out[0].start == 1.0
    assert abs(out[0].end - 1.44) < 1e-9
    assert out[0].velocity == 0.7


def test_real_repeated_notes_are_kept():
    # Ode to Joy "E4 E4" at 100 bpm: onsets 0.6 s apart are two key presses
    notes = [Note(64, 0.0, 0.57), Note(64, 0.6, 0.57)]
    assert len(merge_retriggers(notes, window=0.07)) == 2


def test_same_pitch_overlap_is_trimmed():
    out = merge_retriggers([Note(60, 0.0, 1.0), Note(60, 0.5, 0.5)], window=0.07)
    assert len(out) == 2
    assert abs(out[0].end - 0.5) < 1e-9


def test_retrigger_merge_does_not_touch_other_pitches():
    notes = [Note(64, 0.0, 0.3), Note(65, 0.02, 0.3)]
    assert len(merge_retriggers(notes, window=0.07)) == 2


def test_harmonic_ghost_is_dropped_but_a_played_octave_is_kept():
    ghost = [Note(45, 0.0, 1.0, 0.8), Note(57, 0.01, 0.3, 0.2)]
    assert [n.pitch for n in drop_harmonics(ghost, ratio=0.5)] == [45]
    octave = [Note(45, 0.0, 1.0, 0.8), Note(57, 0.01, 1.0, 0.7)]
    assert len(drop_harmonics(octave, ratio=0.5)) == 2
    assert len(drop_harmonics(ghost, ratio=0.0)) == 2  # rule off


def test_clean_pipeline_sorts_and_applies_all_rules():
    raw = [
        Note(72, 0.5, 0.2, 0.9),
        Note(60, 0.0, 0.3, 0.8),
        Note(60, 0.03, 0.3, 0.4),  # re-trigger
        Note(66, 0.2, 0.2, 0.02),  # ghost
        Note(110, 0.2, 0.2, 0.9),  # out of range
    ]
    out = clean(raw, CleanupOptions())
    assert [(n.pitch, n.start) for n in out] == [(60, 0.0), (72, 0.5)]


def test_beat_grid_subdivides_a_drifting_tempo():
    grid = beat_grid([0.0, 0.5, 1.1], subdivisions=2)
    assert np.allclose(grid, [0.0, 0.25, 0.5, 0.8, 1.1])


def test_quantize_snaps_near_onsets_and_leaves_far_ones():
    grid = np.array([0.0, 0.25, 0.5])
    out = quantize([Note(60, 0.27, 0.2), Note(62, 0.375, 0.1)], grid, max_shift=0.05)
    assert out[0].start == 0.25 and abs(out[0].end - 0.47) < 1e-9
    assert out[1].start == 0.375


def test_group_steps_uses_the_app_chord_window():
    steps = group_steps([Note(60, 0.0, 1), Note(64, 0.04, 1), Note(67, 0.1, 1)])
    assert [[n.pitch for n in s] for s in steps] == [[60, 64], [67]]
