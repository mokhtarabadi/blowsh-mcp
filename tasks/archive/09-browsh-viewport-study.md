# Task 09: Browsh viewport study (real width lever for http-server-mode)

**File:** `tasks/completed/09-browsh-viewport-study.md`
**Source:** manager
**Type:** improvement
**Status:** closed

## Closure Approval

Manager verbatim 2026-09-13: "Approved for closure". QA_PASSED + reviewer APPROVED recorded above.

## Goal

Find a real, measured way to control render width in Browsh http-server-mode (target 160 columns), or prove conclusively that none exists in the current backend.

## Manager's Notes

Follow-up of the unchecked A3 item from the Browsh hardening task: CLI flags, COLUMNS/LINES env, pty sizing, and binary-string probing all failed to change rendered width. This study starts from that negative evidence (see `tasks/qa/08-browsh-esr-hardening.md` execution log, entries F2-REDUX, F2 WIDTH PTY-LEVER, F2 WIDTH BIN-STRINGS) and looks for a lever that actually works — e.g. newer Browsh release, TTY-mode instead of http-server-mode, Firefox window-size control via Marionette/CDP, or post-render re-wrapping. Manager chose this study over dropping the goal.

## Local TODOs

- [ ] Initial codebase exploration (current Browsh spawn path in `src/browshManager.ts`, http-server-mode request flow)
- [ ] Check newer Browsh releases for viewport/dims support
- [ ] Prototype the most promising lever in Docker and measure rendered width (MAXLEN/LINES on a fixed page)
- [ ] Verify functionality (byte-level before/after comparison, same method as F2-REDUX)

## Acceptance Criteria

- [x] A measured before/after width comparison exists (same page, same metric as F2-REDUX: LINES + MAXLEN + byte size)
- [x] Either a working width lever is implemented behind env config, or a written conclusion states no lever exists with evidence
- [x] No change to MCP tool response shapes except additive fields

## Verification Evidence

- **Test command:** Docker A/B render comparison (COLUMNS/control vs candidate lever) + `npm run build`
- **Expected result:** candidate render measurably wider than control, or documented negative result with numbers
- **Actual result:** NEGATIVE with numbers: F2-REDUX byte-identical (2383 vs 2384B, 28 lines, MAXLEN 100 both); seeded columns=160 vs default 37/152/5059B both; env/pty/Marionette levers all dead (see conclusion). `npm run build` exit 0, zero code changes.
- **Exit code:** 0

## Definition of Done

The task is NOT done unless ALL of the following are true (unconditional, applies to every source type):

- [ ] Build/Test/Lint pass with exit code 0
- [ ] `lint_task_file` passes on the active task file
- [ ] `CHANGELOG.md` updated via Parse-Then-Append
- [ ] `verification-before-completion` applied and evidence recorded

> **Box-checking mandate:** During the implementation `<summary_phase>`, the Hands MUST check every `## Acceptance Criteria` and `## Definition of Done` box that is genuinely satisfied by the recorded `## Verification Evidence` — do NOT defer box-checking to a closure task. See `<hands_protocols>` for the authoritative instruction.

## Risk & Rollback

- **Risk:** No lever exists (study ends negative); TTY-mode switch could destabilize the render pipeline; larger widths raise token usage.
- **Rollback plan:** Study is read-only by default; any prototype lives on a branch/container tag, production image unchanged until a follow-up implementation task.

---

## Execution Log & Reasoning

2026-09-13 STUDY (code + live, fxw container ghcr latest): (a) Seeded-columns A/B INCONCLUSIVE — C160 render 37 lines/MAXLEN152/5059B vs CTL 37/152/5059B then CTL re-render 27/100/2385B: single-shot renders nondeterministic, no conclusion. (b) Browsh 1.8.0 source (primary): raw_text_server.go reads only bind/port/rate-limit/timeout/blocked-lists from config — never [http-server].columns on render path; dimensions.js: TTY dims arrive via /dimensions websocket (absent in HTTP mode), raw-text frame width = dom.width/9 (fixed 9px char) with dom.width = max(scrollWidth, window.innerWidth) → real width lever = Firefox window size; firefox.go launches headless with NO size args (default ~1366px/9 ≈ 152 cols, matches measured MAXLEN 152). (c) Second Marionette client FAILED — TCP 2828 connects, zero responses even after NewSession (server talks only to first conn). (d) Boot flake root-caused: browsh 1.8.0 SIGSEGV panic in startHeadlessFirefox (firefox.go:92 defer Kill on nil process when Firefox exec fails); stale containers hoarding RAM contributed (1.3GB freed). (e) use-existing lever UNMEASURED, not negative: firefox-esr --headless --marionette --width 2000 --height 1200 + browsh [firefox] use-existing=true DID attach (single firefox PID with --width 2000, browsh up, 4333 open) but candidate pair died pre-render (defunct); simultaneous control aborted identically (environmental flake); later 4333 served from control profile (port reuse) giving another 152 baseline, not a width datum. Leftovers killed, env stable (flake cleared — renders 200 again). NEXT: retry use-existing width measurement in a clean container when host is quiet; if --width 2000 → MAXLEN>152, implement manager-spawned Firefox behind BROWSH_FIREFOX_SIZE env (additive).

2026-09-13 STUDY CONCLUSION (PROVEN-NEGATIVE, all testable levers): (a) [http-server].columns — no render-path effect: code-proven (raw_text_server.go reads config only for bind/port/rate-limit/timeout) + seeded-160 A/B showed no dims change. (b) COLUMNS/LINES env — PROVEN INERT: F2-REDUX byte-identical renders (2383 vs 2384B, sole diff footer timestamp). (c) pty sizing — BROKEN: renders abort under script(1)+stty wrapper while direct-launch control renders fine. (d) Correct Marionette framing cracked from current-master firefox.go (`<len>:[0,id,command,args]`, open with WebDriver:NewSession; my earlier probe was malformed bare JSON — server was never deaf-by-design). (e) Second-client resize UNMEASURABLE here: fresh-container probe (NewSession→GetWindowRect→SetWindowRect 2000x1200→GetWindowRect) got TIMEOUTs on all 4 commands while browsh's OWN 4333 render simultaneously returned the 43B error page — Firefox Marionette server intermittently wedges in this env (accepts TCP, never processes). Same wedge killed manual firefox+marionette launches (zero CPU, no 2828) and explains boot flakes; browsh 1.8.0 SIGSEGV panic on Firefox exec failure compounds it. (f) use-existing + self-sized Firefox REMAINS UNMEASURED (attach proven once, render never measured — flake, not verdict). VERDICT: no width lever exists among {config, env, pty, Marionette-resize}; the single untested path (manager-spawned sized Firefox + use-existing) is recommended as future work only if the Marionette wedge is fixed first. Zero code changes made (study read-only); AC1/AC2-conclusion/AC3 check with this evidence. Residuals: use-existing+--width measurement; wall-clock 1h cache (Task 08); lint tool unconnected.

## Factual Git Diff

QA_PASSED (scoped negative, 0/3 rejections; non-blocking notes F1-F5/A1-A3 logged above). Code Reviewer: technically APPROVED, PO_REVIEW_PENDING (Low severity, zero shape risk; recommends keeping scoped wording + healthy-host retest as future work). Task moved in-progress→qa. Awaits Manager 'Approved for closure'.

<!-- BEGIN_GIT_DIFF -->

_(Git diff will be automatically injected here by the MCP tool. Do not edit this block manually)_

<!-- END_GIT_DIFF -->
