# VMark Developer Documentation

## Active Docs (tracked in git)

- `dev-docs/architecture.md`: system architecture overview — C4 diagram, entry points, data flows, module map.
- `dev-docs/design-system.md`: design tokens, components, patterns (single source of truth).
- `dev-docs/css-reference.md`: visual QA reference document for CSS changes.
- `dev-docs/cjk-gotchas.md`: CJK formatter pitfalls — things that will bite you if you're not careful.
- `dev-docs/large-file-open-pipeline.md`: end-to-end pipeline for the large-file open UX — tiers, routing, forced Source mode, indeterminate indicator, and the perf tricks in TiptapEditor.
- `dev-docs/plans/20260504-github-actions-workflow-viewer.md`: GitHub Actions workflow viewer + structured editor — IR pivot, ADRs, 10-phase plan with all phases complete. End-user docs at `website/guide/workflow-viewer.md`; perf benchmark at `src/bench/workflow.bench.ts`.
- `dev-docs/house-cleaning/`: recurring framework for paying down measurable debt — daily (T1) / weekly (T2) / monthly (T3) / quarterly (T4) cadence with per-tier runbooks, ledger schema, and findings template. Complements the existing `audit/` chunk reports.
- `dev-docs/audit/20260530-dead-code-and-optimization.md`: multi-round whole-repo audit (dead code, optimization, type safety, duplication, bundle weight, resource lifecycle, Rust panic-safety, concurrency/races, accessibility, test gaps). Grep-verified findings + a cross-round priority list. **Remediated by `dev-docs/plans/20260530-audit-remediation.md`** (branch `chore/audit-remediation`).
- `dev-docs/plans/20260530-audit-remediation.md`: the 6-phase remediation plan for the audit above — WI breakdown, ADRs, Codex cross-model review, and recorded defer/abort decisions. Implemented end-to-end; Status header tracks what shipped vs. deferred (WI-2.6 abort, WI-2.8 defer, T4/O8/D8/A4/C6 deferred).
- `dev-docs/audit/20260530-plan-audit-findings.md`: conformance audit of the shipped remediation against the plan + source audit — flags plan-vs-audit completeness gaps (T4 Medium follow-up) and partial-AC items (WI-0.2 store test, WI-4.1 2-of-4 validators, WI-1.1 visual QA pending).
- `dev-docs/audit/20260531-terminal-integration.md`: deep audit of the integrated terminal (PTY backend, IPC wrapper, xterm addons, session lifecycle) vs. VS Code/Ghostty/WezTerm. Grep-verified findings + prioritized backlog. Top items: PTY output crosses IPC as a JSON number array (T1, P0), no shell integration / OSC 7 / OSC 8 (M1–M3), file links discard `:line:col` (C1), sessions don't survive restart and SerializeAddon is loaded-but-unused (C3). **Remediation plan: `dev-docs/plans/20260531-terminal-industrial-best.md`.**
- `dev-docs/audit/20260601-terminal-gaps.md`: follow-up reinvestigation of the terminal *after* the industrial-best merge. Four parallel deep-dives + a second deeper pass, every finding re-verified in source. Headline: one real user-facing regression — shell integration breaks custom `$ZDOTDIR` setups (`shell_integration.rs` never resolves/passes `USER_ZDOTDIR`; needs a login-shell query) — plus paste bypassing bracketed-paste mode, no screen-reader support, OSC 0/2 title dropped, and security link code (`setupWebLinks.ts`) with zero tests. Confirms multi-window isolation and Channel flow-control are SAFE (corrects first-pass suspicions), and records false positives. Prioritized P0–P3 backlog.
- `dev-docs/plans/20260601-terminal-gap-remediation.md`: 4-phase, WI-decomposed remediation plan for the gaps in `20260601-terminal-gaps.md`. Phase 1 (P0) fixes the custom-`$ZDOTDIR` regression via a cached login-shell resolver + `USER_ZDOTDIR` (ADR D1); Phase 2 (P1) paste-via-`term.paste()` + security tests for `setupWebLinks`/`setupFileLinks`; Phase 3 (P2) `screenReaderMode` setting + OSC 0/1/2 tab title; Phase 4 (P3) font-sync/scrollback/reader-logging/`wait()`/settings + coverage backfill; Phase 5 lists deferred product scope. Includes ADRs/Decision Log, Open Questions, gap→WI map, per-phase DoD (`scripts/check-terminal-gaps-phase.sh`), and a Manual Test Checklist. Needs Codex review before Phase 1 (rule 60 §6).
- `dev-docs/plans/20260531-terminal-industrial-best.md`: 7-phase, WI-decomposed plan for the terminal audit above. Phase 0 spike gate (Tauri binary `Channel`, zsh shell-integration injection, L1 orphan repro) → Phase 1 throughput (T1–T3, L2) → Phase 2 cwd/OSC 7 → Phase 3 shell integration/OSC 133 → Phase 4 links+display (C1, M3, M4) → Phase 5 persistence (C3) → Phase 6 process-group kill (conditional). Includes ADR-T1..T4, per-phase machine-checkable DoD (`scripts/check-terminal-phase.sh`), and a pre-Phase-1 Codex review gate.
- `dev-docs/audit/20260531-dead-code-resweep.md`: independent follow-up to the 2026-05-30 dead-code audit. Re-runs `knip` + `cargo check`, verifies the remediation held (high-value dead code confirmed gone), and precisely categorises the deferred tail (14 redundant `default` exports, 91 dead barrel re-exports, ~10 genuinely-dead named exports vs. over-exported-but-alive). Includes a deep-dive on the workflow snapshot half-feature: confirms the WI-1.5 KEEP decision is sound and refines the cost as conditional (only `action/save-file` workflows snapshot). **Outcome:** added a workspace-aware `knip.json`, executed a surgical export-hygiene sweep (14 redundant defaults + 5 dead decls + stray `.d.ts`; verified `tsc`/19,256 tests/`check:all` green), and wired `pnpm knip` into `check:all` with an `error`/`warn` rule split (files/deps/imports fail CI; export/type hygiene reported non-blocking).
- `dev-docs/decisions/`: architecture decision records (ADRs).
  - `heading-ime-composition-fix.md`: How we fixed the WebKit heading IME split-block bug — 5 attempts, root cause analysis, and why prevention beats repair.

## Agent Configuration

- `AGENTS.md`: working agreement + required practices.
- `.claude/rules/`: engineering guardrails, TDD, UI consistency, design tokens, shortcuts.

## Website (User-Facing Docs)

- `website/guide/`: VitePress site for end-user documentation.
- See `.claude/rules/21-website-docs.md` for sync rules.

## Documentation Conventions

- Prefer a single source of truth for each topic.
- Date + status new documents (Active / Historical / Draft) to reduce ambiguity.
- Update docs in the same change that modifies behavior.

## Important History

Records of significant codebase-wide changes — process, decisions, and lessons learned.

- `important-history/20260214-codebase-documentation.md`: How we added AI-maintenance comments to ~400 files using parallel git worktrees.
- `important-history/20260423-smart-cmd-a-hidden-cost.md`: What Issue #816 taught us about replacing universal keyboard conventions — a retrospective + checklist for future "nice features".

## Archive

Historical docs live in `archive/` (local, not tracked in git).
