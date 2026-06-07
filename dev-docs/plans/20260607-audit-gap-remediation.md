# Audit Gap Remediation

> Created: 2026-06-07
> Status: **In progress** on branch `chore/audit-gap-remediation`.
> Source backlog: `dev-docs/audit/20260607-wi-audit-report.md` (§C L1–L21, §D, §E).
> Mandate: fill ALL gaps incl. risky items; manual checks done via Tauri MCP.

## Approach

Phased by risk. TDD for behavior (rule 10). Atomic commits per RW, each
referencing its `RW-N` id (rule 60 §2). `pnpm check:all` green at each phase
boundary. Risky/breaking work isolated to Phase 4 with explicit live
verification. Manual a11y/XSS/visual passes via Tauri MCP in Phase 6.

## Work items (mapped to audit §C)

### Phase 1 — Safe, high-value, TDD
- **RW-1** (L5) — `errorMessage.test.ts` for the 71-site helper.
- **RW-2** (L4) — Genie UI tests: `ApprovalDialog`, `WorkflowSidePanel`, `WorkflowNode`.
- **RW-3** (L18) — Replace 2 production `.expect()` in `lib.rs`; migrate 5 `console.warn` to debug loggers.
- **RW-4** (L15) — Per-tool `version` keys in `capabilities/*.json`.
- **RW-5** (L17) — `iframe` support in Source media popup.
- **RW-6** (L10) — Workflow runner `if:` expression evaluation + tests.
- **RW-7** (L3) — Wire GHA workflow export (`toMermaid`/`toImage`) to a UI action.

### Phase 2 — Content / docs
- **RW-8** (L1) — Bundled sample workflow + `examples.rs` integration test + `tauri.conf.json` bundle entry.
- **RW-9** (L2) — `website/guide/workflows.md` + sidebar + `ai-genies.md` cross-section.
- **RW-10** (L19) — Large-file perf harness (corpus gen + `measure-open-latency`).
- **RW-11** (L20) — i18n announce artifacts (announcement doc + blog post).

### Phase 3 — Infra / quality
- **RW-12** (L14) — Perf bench step in CI.
- **RW-13** (L12) — E2E smoke harness (Tauri MCP-driven).
- **RW-14** (L13) — Rust mutation (cargo-mutants) + parser fuzz (cargo-fuzz) targets.
- **RW-15** (L11) — a11y track: vitest-axe + app-wide ARIA landmarks + tests.

### Phase 4 — Risky / architectural (isolated, live-verified)
- **RW-16** (L8) — API keys → OS secure storage (keychain via Tauri).
- **RW-17** (L9) — Remove CSP `unsafe-inline` (script + style).
- **RW-18** (L16) — Theme dual-path collapse (fold `darkModeColors` into `night.ts`, reduce `useTheme.ts`) + prove with a 6th theme; merge terminal font/lineHeight; alias-chain codemod.

### Phase 5 — Governance / checker-rot (no behavior change)
- **RW-19** (§D) — Fix rotted greps in `check-gha-phase.sh`, `check-terminal-gaps-phase.sh`, `check-multi-format-phase.sh`.
- **RW-20** (§E) — Update stale plan headers + comment rot.

### Phase 6 — Manual verification via Tauri MCP
- **RW-21** (L6) — HTML-sandbox XSS test in live Tauri webview.
- **RW-22** (L7) — Visual QA (light + dark) against `css-reference.md`.
- **RW-23** (L21) — 15-item VoiceOver/keyboard a11y checklist for the workflow viewer.

## Definition of Done
Every RW landed or explicitly re-deferred with rationale; `pnpm check:all` green;
risky items live-verified; audit report §C items struck through with their RW.
