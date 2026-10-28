---
paths:
  - "dev-docs/plans/**"
  - ".claude/tdd-guardian/**"
  - ".claude/hooks/**"
  - ".githooks/**"
  - ".github/**"
  - "scripts/check-*-phase.sh"
  - "scripts/check-wi-linkage.sh"
  - "scripts/check-new-deps.sh"
  - "scripts/check-baseline-ratchet.mjs"
  - "scripts/baselineRatchetManifest.mjs"
  - "scripts/check-change-size.mjs"
  - "scripts/check-tag-green.sh"
---

# 60 - AI Governance

Rules for keeping AI-assisted, multi-phase work honest. The pre-cleanup long
form (incident history, measurements) is `git show 12c98051e:.claude/rules/60-ai-governance.md`.

## 1. Plan files are the contract

Long-running features (>1 day, >5 files) need a plan `YYYYMMDD-name.md` with
ADRs, work items (`WI-N.M`) and a Definition of Done per phase.

| Home | Tracked? | Use when |
|---|---|---|
| `dev-docs/plans/` | no (gitignored) | maintainer-local plans |
| `.claude/tdd-guardian/` | yes | CI, a DoD script, or future readers depend on it |

Namespace WI-IDs when plans coexist (`WI-AF1.2`, `WI-VC0.1`): linkage searches
the whole repo, so a bare `WI-5.2` is satisfied by any plan's `WI-5.2`.

## 2. Work items must be linked

Every WI in a complete phase is linked by a commit tag `feat(scope): … (WI-1.2)`
or a test-file header `// WI-1.2 — <description>`. Prose mentions do not count.
Verify: `bash scripts/check-wi-linkage.sh <plan-file> [--phase=N]`.

## 3. Phase boundaries are gated by scripts

Each phase has a machine-checkable DoD script (template:
`scripts/check-gha-phase.sh`) that must exit 0 before the plan advances.

## 4. New dependencies are reviewed for hallucination

`scripts/check-new-deps.sh` (CI, every npm manifest) flags packages that do not
exist, are <30 days old, or have <1000 weekly downloads. A flagged package needs
explicit acknowledgment in the PR description. New crates: check the repository
and download count by hand (`cargo audit` + Dependabot cover advisories).

## 5. Test-first is hook-enforced for high-risk paths

`.claude/hooks/gha-tdd-guard.mjs` blocks `Write`/`Edit` on scoped production
files without a sibling test (allowed: `*.test.ts(x)`, `types.ts`, `*.d.ts`,
`*.css`). Scope lives in the hook's `SCOPED` array; its test asserts every
scoped path exists. Extend the array to cover a new high-risk feature.

## 6. Cross-model review at risk points

Plans >~500 lines or >3 phases, or that add external dependencies, get
`/cc-suite:review-plan` (Codex) before Phase 1.

## 7. Spike before commit on high-risk technology choices

An ADR resting on an unverified library assumption needs a Phase 0 spike under
`dev-docs/grills/<feature>/` with a runnable probe.

## 8. Subagent context isolation

Dispatch verbose search/audit/research to subagents (`Explore`, `auditor`,
`impact-analyst`, `test-runner`) rather than filling the main thread. New
session per phase.

## 9. Don't bypass; ask

`--no-verify`, removing a hook from `.claude/settings.json`, or changing the
WI-linkage regex requires explicit user authorization. Fix the gate instead, and
document any granted bypass.

## 10. `main` and release tags are gated at push time

- `main`: branch protection with required `frontend` + `rust`,
  `enforce_admins: true`, PR required (0 approvals), no force-push. Direct
  pushes of new commits are rejected — releases go through a PR (rule 40).
- CI is `pull_request`-only. `strict: true` (branch must contain main's tip) is
  what makes that safe; **if `strict` is ever turned off, restore
  `push: [main]` in `ci.yml` in the same change.**
- `v*` tags: `.githooks/pre-push` runs `scripts/check-tag-green.sh`, which
  requires green `frontend` + `rust` on the tagged commit or an ancestor with an
  IDENTICAL tree. Fails closed. `VMARK_OFFLINE_GATE=1` runs the full local gate
  (cross-target check, `cargo fmt --check`, clippy, `check:all`) instead.
- Local green is not CI green: local tooling runs Rust only on macOS, merely
  compiles for Windows, and does nothing for Linux; `check:all` never runs
  cargo. Never make the tag gate accept a status CI did not actually produce.

## 11. Committed baselines are re-checked against the merge base

`scripts/check-baseline-ratchet.mjs` (CI only, fails closed without a base ref)
re-reads every ratcheting baseline at the merge base. Adding a baseline means
registering it in the manifest in the same change. Prefer identity baselines
over counts. A genuine re-measurement uses a manifest `allowRaise` entry with a
reason; it goes stale once merged and must then be deleted.

## 12. Dark-feature verdicts

- **Knowledge Base / content-server runtime**: developer-mode-only (maintainer
  decision 2026-09-18, #1425). Entry points are hidden unless
  `advanced.developerMode` via `knowledgeBaseAvailableHere`. Re-open when a
  runtime is bundled; `release-smoke.yml`'s `cli=missing` assertion flips then.
- **Embedded browser**: on by default, macOS-only (maintainer decision
  2026-08-15). AI posture defaults (`aiSession: "sandbox"`,
  `aiAllowLoopback: false`), the SSRF policy, approvals and origin grants stay
  as they are; `browser_ai_policy` is pushed to Rust at bootstrap.
- **Workflow viewer**: unconditional; the `advanced.workflowViewer` flag is
  removed.
- **Workflow engine**: recommended EXTRACT behind a cargo feature + build-time
  frontend flag by 2026-10-01, else keep dark behind the WI-19 backend gate.
  `run_workflow` backs genie workflows, so removal is a migration.
  **RE-VERDICT 2026-09-27:** the maintainer decided to KEEP the engine in every
  build behind `advanced.workflowEngine` (default off, developer-gated) and make
  it work — the Run/Cancel panel opens for VMark workflow `.yml` files in the
  yaml split pane, and a finished run's pre-run snapshot is restorable. The
  EXTRACT recommendation and its 2026-10-01 date are withdrawn; the WI-19
  backend gate stays the enforcement. Next review: 2027-03-27, or sooner if the
  setting is proposed to leave Developer Tools or to default on.
- The pushed policy flags (`workflow_engine_policy`, `browser_ai_policy`) only
  stop UI-less paths from running a disabled feature; they are not a security
  boundary. Only commands that START work are gated — cancel/approval commands
  must keep working when the feature is turned off.

## 13. Change size is a decision, not an accident

`scripts/check-change-size.mjs` (PR tier) requires a `CHANGE-SIZE-ACK:` line in
the PR body when a diff exceeds the thresholds in
`scripts/change-size-policy.json` (measured p90: 150 files / 10,000 lines). It
is a forcing function, not a control. Re-measure before changing thresholds.
