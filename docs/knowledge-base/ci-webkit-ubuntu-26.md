# CI: Playwright WebKit crashes on Ubuntu 26.04 runners

**Seen:** 2026-11-08, PR #45. Every `ipad-webkit` e2e test failed with `page.goto: Page crashed` or a
30 s timeout on the very first navigation — including tests the PR did not touch. Desktop Chromium and
the local run (macOS WebKit, 37/37) passed. A re-run failed the same way.

**Cause:** GitHub moved `ubuntu-latest` to **ubuntu-26.04** (runner image 20261101). The last green run
(2026-11-01) was on ubuntu-24.04. Playwright 1.64's WebKit build does not run on 26.04 (inferred from the
timing and the image change; no upstream issue checked).

**Fix:** the `e2e` job pins `runs-on: ubuntu-24.04` (`.github/workflows/ci.yml`). Remove the pin once a
Playwright release supports Ubuntu 26.04 — check its release notes / `npx playwright install --with-deps`
on 26.04 first.
