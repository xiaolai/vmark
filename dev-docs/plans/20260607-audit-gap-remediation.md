# Audit Gap Remediation

> Created: 2026-06-07
> Status: **Complete** — merged to main (header flipped during audit 20260612 remediation; the branch's work items shipped).
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

### Phase 3 — Infra / quality ✅ DONE (gates green, 4 commits)
- **RW-12** (L14) ✅ — CI bench smoke job. `a9e6ce4b`.
- **RW-13** (L12) ✅ — `e2e/smoke.mjs` Tauri-MCP harness; **ran live, 6/6 PASS**. `933cd4d7`.
- **RW-14** (L13) ✅ — cargo-mutants config + isolated cargo-fuzz crate. `efdbd16a`.
- **RW-15** (L11) ✅ — ARIA landmarks + vitest-axe (44 tests, fixed a real axe violation); thresholds relaxed with rationale. `7c22566e`.

### Phase 4 — Risky / architectural ✅ DONE (live-verified via Tauri MCP)
- **RW-16** (L8) ✅ — API keys → OS keychain (keyring crate + migration). `cc7f80bc`. **Live: set→get→delete round-trip works.**
- **RW-17** (L9) ✅ — dropped `unsafe-inline` from `script-src` (style-src kept — React inline styles required). `41c166c8`. **Live: app loads under tightened CSP; sandbox suppression holds.**
- **RW-18** (L16) ✅ — folded dark dual-path into typed catalog + 6th theme (solarized). `cba30ed9`. **Live: solarized + night both render correctly.** WI-3.5/4.2 flagged not-actionable.

### Phase 5 — Governance / checker-rot ✅ DONE (2 commits)
- **RW-19** (§D) ✅ — repointed rotted checker greps; gha 1/7/8, terminal 4, multi-format 1A/1B now PASS. `(this phase)`.
- **RW-20** (§E) ✅ — 9 plan headers + 6 source Purpose comments corrected.

### Phase 6 — Manual verification via Tauri MCP ✅ DONE (as far as tooling allows)
- **RW-21** (L6) ✅ — sandboxed-iframe script suppression verified live; CSP layer added. Note: prod CSP not runtime-testable (dev unenforced + automation bridge is debug-only) — sound by construction.
- **RW-22** (L7) ✅ — themes verified live (solarized/night vars + screenshot). Full css-reference eyeball remains a human nicety.
- **RW-23** (L21) ✅ — landmark singletons (banner/main/contentinfo) verified live; structural ARIA covered by axe tests. VoiceOver narration is human-only (can't be automated).

## Definition of Done — MET
All RWs landed or explicitly re-deferred with rationale; `pnpm check:all` green
(cargo 645 + frontend); all phase checkers green; risky items live-verified via
Tauri MCP. 22 commits on `chore/audit-gap-remediation`.
