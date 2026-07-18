# Coherence Dogfood Log

Per-session metric record against the spec §11 baselines
(plan "Dogfood protocol"). The **real creative project remains the one
open user decision** — until it lands, sessions here run on the synthetic
story-world workspace, explicitly labeled.

## Session 1 — 2026-07-18 (synthetic, scripted)

- **Workspace:** synthetic (story-world corpus: 3 world docs, 3 generated
  scenes, 1 MCP-written chapter). Driven as a scripted session through
  the real kernel APIs — the same code paths the app funnels call
  (`commands.test.rs::synthetic_dogfood_session_m1`, run green in CI).
- **Actions:** 3 human saves, 3 genie-style generations with input sets,
  1 MCP-style write with a session-read input, 1 aggressive upstream
  rewrite (Elena's eyes), 1 ratification, 1 waiver.

| Metric | Value | Baseline/threshold (spec §11) | Verdict |
|---|---|---|---|
| M1 capture coverage | **4/4 = 100%** AI generations complete at designed confidence (3 exact + 1 inferred); 0 manual metadata entries | 100%, 0 manual | ✅ at baseline |
| M2 staleness precision | 2/2 flagged edges relevant (scene-01, scene-03 — both genuinely read Elena; scene-02 correctly untouched) | ≥ 60% | ✅ (scripted — real judgment pending real project) |
| M3 semantic-check precision | n/a (Phase 2b) — S4 spike baseline 88.9% | ≥ 70% before Phase 2b | recorded |
| M4 ratification burden | 2 resolutions for 1 upstream rewrite touching 2 dependents | ≤ 10/session | ✅ |
| M5 time-to-confidence | Blast radius (exactly scene-01 + scene-03, not scene-02) visible in one breakdown pull, < 1 s | ≤ 5 min | ✅ (scripted) |

**Caveats:** this is a scripted synthetic session — it validates the
mechanism (capture completeness, blast-radius correctness, resolution
records), not the lived experience. M2/M5 judgments are by construction,
not by a human mid-project. The qualitative gate (paper §12: "recurse
without fear") can only be evaluated on the real project.

**Next session:** the user's chosen creative project (open question 1 in
the plan).
