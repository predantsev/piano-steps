"""The demo fixture must match packages/core's demos (it is a copy: this module never imports TS)."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
SCRIPT = REPO / "tools/transcribe/scripts/export_demo_fixture.ts"


@pytest.mark.skipif(
    not (REPO / "node_modules/.bin/tsx").exists() or not shutil.which("node"),
    reason="needs the repo's node_modules (npm install at the repo root)",
)
def test_fixture_matches_core_demos():
    out = subprocess.run([str(REPO / "node_modules/.bin/tsx"), str(SCRIPT)], cwd=REPO, capture_output=True, text=True, check=True)
    fresh = json.loads(out.stdout)
    stored = json.loads((HERE / "fixtures/demo-lessons.json").read_text())
    assert stored == fresh, f"regenerate: npx tsx {SCRIPT.relative_to(REPO)} > tools/transcribe/tests/fixtures/demo-lessons.json"
