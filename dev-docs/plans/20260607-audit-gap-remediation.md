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

### Phase 1 — Safe, high-value, TDD ✅ DONE (gate green, 8 commits)
- **RW-1** (L5) ✅ — `errorMessage.test.ts` (8 tests). `bede06f1`.
- **RW-2** (L4) ✅ — Genie UI tests (29 tests) + **bug fix**: ApprovalDialog fail-loud on IPC rejection. `da16d417`.
- **RW-3** (L18) ✅ — lib.rs build `.expect()` → logged exit; hex-header expect documented as infallible; perfLog off `console.warn`. (Audit's "5 console.warn" was stale — only 1 was real.) `35476565`.
- **RW-4** (L15) ✅ — version marker in capability `description` (schema has no `version` field). `54eae94f`.
- **RW-5** (L17) ✅ — `iframe` detection in Source media popup. `4a36e06d`.
- **RW-6** (L10) ✅ — `condition.rs` evaluator (literals, success/failure/always, comparisons, &&/||/!, refs) + fail-loud. `ec897899`. Known limit: `failure()`/`always()` latent until runner dependency-skip is revisited.
- **RW-7** (L3) ✅ — `WorkflowExportControl` on the canvas (Mermaid/SVG/PNG). `4cafa8af`.

### Phase 2 — Content / docs ✅ DONE (gates green, 3 commits)
- **RW-8** (L1) ✅ — `triage-and-translate.yml` sample + bundle entry + `examples.rs` (4 tests). `f0787ebd`.
- **RW-9** (L2) ✅ — `workflows.md` canonical (+ `workflow-genies.md` redirect — docs *did* exist under that name; audit L2 was partly wrong) + sidebar + ai-genies cross-section. `76248ab6`.
- **RW-10** (L19) ✅ — corpus gen + measure-open-latency scripts + package.json. `23c2b908`.
- **RW-11** (L20) ✅ — i18n launch blog + GA announce artifact. `76248ab6`.
- Follow-up: workflows.md + i18n blog need a 9-locale translate-docs pass.

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
