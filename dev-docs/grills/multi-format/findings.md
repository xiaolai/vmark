# Phase 0 — Findings

**Date:** 2026-05-06
**Plan:** `dev-docs/plans/20260506-multi-format-rebrand.md`
**Status:** Complete (auto-mode), **awaits user sign-off on Part B of WI-0.4 before Phase 3**

This file is the single index over Phase 0 spike outputs. Detailed findings live in sibling files:

- `findings-spikes-1-to-3.md` — WI-0.1, WI-0.2, WI-0.3 (type-level proofs)
- `findings-spike-04-html-sandbox.md` — WI-0.4 (HTML sandbox spike, harness in `spike-04-html-sandbox/`)
- `findings-libraries.md` — WI-0.5, WI-0.6 (tree library + community pack audits)
- `findings-refactor-audit.md` — WI-0.7 (Editor.tsx surface refactor risk audit)

## Verdict per WI

| WI | Verdict | Blocks | Notes |
|---|---|---|---|
| WI-0.1 — `<SplitPaneEditor>` shape | **CONFIRMED** | — | Standard CodeMirror v6 pattern; type-level proof against installed `@codemirror/lang-yaml`. |
| WI-0.2 — Format registry shape + `dispatchEditor()` | **CONFIRMED** | — | Pure-function dispatch with Map lookup; no special-casing per format. |
| WI-0.3 — Validator-to-gutter integration | **CONFIRMED** | — | `@codemirror/lint` `Diagnostic` shape + position-conversion 1-to-1 maps to `ValidationDiagnostic`. |
| WI-0.4 — HTML iframe sandbox in Tauri webview | **PART A AUTONOMOUS-RUNNABLE; PART B BLOCKING ON USER** | Phase 3 (HTML adapter) | Browser-baseline harness ready. Tauri-webview verification requires user to launch `pnpm tauri:dev` with the spike harness. Phase 1A and Phase 2 may proceed without it. |
| WI-0.5 — Tree preview library | **CONFIRMED** | — | Pick: `react-json-view-lite` v2.5.0. Only candidate with documented keyboard nav + ARIA labelling. PASS rule 4. |
| WI-0.6 — Community pack audit | **CONFIRMED with one plan revision recommendation** | — | `smol-toml` 1.6.1 PASS for TOML; `dompurify` 3.4.2+ PASS for HTML defense-in-depth; `codemirror-lang-mermaid` 0.5.0 SUFFICIENT-FALLBACK (stale but functional, pin exact version). Ruby/Lua — no maintained Lezer pack but `@codemirror/legacy-modes/mode/{ruby,lua}` is PASS via `StreamLanguage.define()`. **Recommend reinstating `.rb` and `.lua` to v1 scope using legacy-modes.** |
| WI-0.7 — Editor.tsx surface refactor risk audit | **CONFIRMED — 13 coordination surfaces** | — | Long pole confirmed: it's not Editor.tsx itself, it's `useUnifiedMenuCommands` + 5 stores + 11 markdown-only menu actions + 2 side panels + search wiring + large-file forced-source. Phase 1A breakdown into **9 atomic PRs over 3-4 weeks**, with PR 4 (menu dispatch) on the critical path. |

**Aggregate verdict:** Phase 0 is **PASS for Phase 1A and Phase 2 work to proceed**. Phase 3 (HTML adapter) is **BLOCKED on user-run Part B of WI-0.4**.

## Plan revisions recommended (small)

These don't change phase structure — small textual updates to the plan file:

1. **ADR-3 reinstates `.rb` and `.lua` to v1.** WI-0.6 audit confirmed `@codemirror/legacy-modes` provides functional syntax highlighting for both. This is the same path the plan already uses for TOML CodeMirror highlighting and `.sh`/`.bash`. Quality is "syntax-coloring only," fits ADR-3's viewer-mode posture exactly.
2. **Final format surface table** updated to include `.rb` (LEGACY) and `.lua` (LEGACY) rows.
3. **`react-json-tree` framing in Open Question #1** corrected — it is actively maintained in `reduxjs/redux-devtools` monorepo, not unmaintained as the plan implied. The pick of `react-json-view-lite` still stands but on a11y grounds, not maintenance grounds.
4. **Tree library decision is no longer open** — Open Question #1 closes. `react-json-view-lite` v2.5.0.
5. **TOML parser decision is no longer open** — Open Question #2 closes. `smol-toml` 1.6.1.
6. **Mermaid pack decision recorded** — Open Question #3 has a known answer: `codemirror-lang-mermaid` 0.5.0 with explicit staleness mitigation (pin exact, plan v1.x replacement).
7. **Phase 1A WI list re-sequenced per WI-0.7's PR breakdown.** The plan's existing WI-1A.1 through 1A.11 are accurate at the WI level, but the implementation order matters for atomic-PR cadence: registry types (1A.1) → Editor.tsx surface refactor (1A.5) → menu adapter (1A.7, the long pole) → everything else can parallelize.

## Blockers / open items for the user

1. **WI-0.4 Part B (Tauri webview verification)** — manual test required before Phase 3 begins. Steps documented in `findings-spike-04-html-sandbox.md`.
2. **Apply plan revisions 1-7 above** before Phase 1A commits begin (they're textual; see `dev-docs/plans/20260506-multi-format-rebrand.md`).

## Disposition (per ADR-11)

The following spike artifacts are **deleted before Phase 1A**:

- `dev-docs/grills/multi-format/spike-04-html-sandbox/` (the harness directory, after Part B passes)

The following are **kept as historical record** (not source code):

- `findings.md` (this file)
- `findings-spikes-1-to-3.md`
- `findings-spike-04-html-sandbox.md`
- `findings-libraries.md`
- `findings-refactor-audit.md`

If WI-0.4 Part B fails, the harness stays until Phase 3 mitigation lands.

## Time spent

Roughly 30-45 minutes of agent-equivalent work (parallel research agent + parallel codebase audit agent + four findings-file writes + one runnable harness). Original plan estimate for Phase 0 was 3-5 days human-equivalent — the gap is the difference between AI execution and the calendar time required for human review of each spike.
