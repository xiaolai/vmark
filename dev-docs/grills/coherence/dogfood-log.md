---
vmark:
  id: 019f758c-5536-79f0-9301-a463477869de
---
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

## Session 2 — self-hosted (codex-as-human)

- **Workspace:** the VMark repository itself (self-hosted; owner decision
  made by Codex acting as the human — plan open question 1 resolved for
  Phase A). Corpus: paper → plan/spec/architecture → website guides →
  this log. All edits authored by codex-as-human; transported through
  the app's workflow funnel (`action/read-file` → `action/save-file`),
  resolutions driven through the Breakdown panel UI.
- **Actions:** 6 derived-doc refreshes establishing 8 edges (exact), 1
  external upstream edit to the paper (watcher → scan reconciliation), 1
  spec re-derivation, 1 guide re-derivation, 2 ratifications, 1 waiver
  with written reason.

| Metric | Value | Baseline/threshold (spec §11) | Verdict |
|---|---|---|---|
| M1 capture coverage | **10/10 = 100%** transformations at designed confidence (all exact via workflow funnel); 0 manual entries | 100%, 0 manual | ✅ |
| M2 staleness precision | **5/5** flagged edges judged relevant by the owner (paper→plan/spec/architecture; spec→both guides after revision). Two-hop isolation held: guides did not flag on the paper edit, only on the spec revision; this log never flagged | ≥ 60% | ✅ |
| M3 semantic-check precision | n/a (Phase 2b) | ≥ 70% before Phase 2b | — |
| M4 ratification burden | **5 resolutions** (2 ratify, 2 revise, 1 waive) — exactly the owner's ≤5 session budget; no sixth prompt appeared | ≤ 10/session | ✅ |
| M5 time-to-confidence | **12.4 s** from external paper save to complete 3-edge blast radius in one breakdown pull | ≤ 5 min | ✅ numerically; owner: "tolerable, too slow for smooth flow" — see F2 |

**Findings:**

- **F1 (fixed):** identity insert duplicated the `id:` key when content
  carried a malformed `vmark.id` — invalid YAML. Fixed same day with a
  failing test first (`insert_identity_replaces_stale_id_and_schema_children`).
- **F2 (fixed + verified):** the workspace scan walked build-artifact
  trees (`src-tauri/target`), dominating M5's 12.4 s. Fixed same day
  (CACHEDIR.TAG-tagged directories skipped, failing test first); post-fix
  full-repo scan measured **219 ms** and a breakdown pull **108 ms** in
  the live app — the M5 scan component down ~56×.
- **F4 (retracted — observer error):** `.vmark/.gitignore` /
  `.vmark/.gitattributes` were reported missing after first init, but the
  kernel had written both correctly (`ensure_initialized`, covered by
  `state.test.rs`); the session runner's `ls -R` simply hides dotfiles.
  The runner overwrote them with byte-identical content before spotting
  the mistake. Lesson: verify "missing file" findings with `ls -la`.
- **F3 (operational):** editing Rust sources mid-session restarts the
  tauri dev app and drops session windows — schedule kernel fixes outside
  live sessions.

**Deviations:** the `phase1-e2e.md` edge (9th in the owner's script) was
not established; MCP client funnels were unavailable this session (stale
sidecar build on one client, exec-mode elicitation auto-deny on the
other) — the workflow funnel carried all derivations instead.

**Owner verdict (codex-as-human): PASS WITH RESERVATIONS.** Trust earned:
exact confidence, honest downstream surfacing, complete blast radius,
required waiver reasons. Still needs proof: F2 fix, live MCP-funnel
session, the missing ninth edge. Next step: fix F2, then re-run the
complete nine-edge dogfood through the intended MCP funnels.

*Post-session bookkeeping note: updating the plan's Status with these
results re-flags the architecture edge (it pins the plan); that
ratification is session-external.*

## Session 3 — 2026-07-19 (self-hosted, Phase 2b semantic layer)

- **Workspace:** the VMark repository (continuing session 2's corpus).
- **Actions:** the ninth edge (plan + spec → `phase1-e2e.md`) established
  **through the shipping MCP funnel** — a minimal stdio MCP client drove
  the sidecar; both upstreams read in-session, the write captured at
  `inferred` confidence with read-time pins (intent `mcp-document-write`).
  One claim extracted from the paper and promoted to established. One
  genuine spec edit (a §5.4.4→§6 cross-reference) flagged exactly the two
  spec-pinned edges; the externally-edited guides' superseded edges were
  correctly suppressed by strict liveness. Two REAL semantic checks ran
  through the claude CLI provider; both rows displayed `stale-valid` and
  were then ratified.

| Metric | Value | Baseline/threshold (spec §11) | Verdict |
|---|---|---|---|
| M3 semantic-check precision | **2/2** — owner agreed with both `no-contradiction` verdicts (0.93/0.95 confidence, 3 evidence quotes each, claim-inclusive fingerprints, default-context binding) | ≥ 70% | ✅ |
| M5 scan component | **234 ms** full-repo scan, `complete: true` (F2 fix at scale) | ≤ 5 min | ✅ |
| Session-2 reservations | ninth edge ✅ (MCP funnel, inferred) · live MCP-funnel run ✅ · F2 re-verified ✅ | all closed | ✅ |

**Findings:** F5 (operational) — the bridge routes MCP requests to the
focused/main window only; a workspace opened in a `doc-*` window is
invisible to the MCP path-scoping guard. Worked around by opening the
workspace in `main` via the app's own recent-workspace command; worth a
Phase 3 look (route by workspace, not window). F6 (retracted on
investigation — WI-3.5) — the reported "disconnect closes tabs / drops
the workspace" symptom does NOT come from the bridge: neither the Rust
disconnect handler nor the frontend `clients-changed` listener closes
tabs or drops a workspace (both verified). The session-2/3 symptom was
manual localStorage manipulation during the test drive, not bridge
behavior. The guarantee is now locked by a regression test
(`disconnect_preserves_window_workspaces`).

**Owner verdict (codex-as-human): PASS.** Next step: Phase 3 plan
amendment, starting with lazy-confirmation inference for human edits.
