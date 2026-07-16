# 60 - AI Governance

Rules for keeping AI-assisted implementation honest across long-running
multi-phase work. Background and field practices: see
`dev-docs/grills/ai-governance-2026-05.md`.

## 1. Plan files are the contract

Long-running features (>1 day, >5 files) must have a plan in
`dev-docs/plans/YYYYMMDD-name.md`. Plans contain ADRs, work items
(`WI-N.M`), and a Definition of Done per phase. Implementation references
the plan; the plan does not chase implementation.

## 2. Work items must be linked

Every WI in a "complete" phase must be traceable in **either** a commit
message **or** a top-of-file comment in its test file:

| Linkage path | Format |
|---|---|
| Commit message | `feat(scope): <change> (WI-1.2)` |
| Test header | `// WI-1.2 — <one-line description>` |

Verify with: `bash scripts/check-wi-linkage.sh <plan-file> [--phase=N]`.

## 3. Phase boundaries are gated by scripts, not prose

Each plan phase has machine-checkable Definition of Done. For the
GitHub Actions workflow viewer plan:
`bash scripts/check-gha-phase.sh <phase-number>` must exit 0 before the
plan's Status header ticks to the next phase.

When you start a new long-running plan, copy `scripts/check-gha-phase.sh`
as a template and fill in per-phase assertions.

## 4. New dependencies are reviewed for hallucination

LLMs hallucinate package names at 5-22% rate (USENIX 2025), with active
slopsquatting attacks. Every PR that adds an npm dependency to ANY
manifest (root, `vmark-mcp-server/`, `website/`) runs
`scripts/check-new-deps.sh` in CI. The script parses the dependency
objects (not diff lines), fails closed on metadata errors, and flags
packages that:
- Don't exist on npm (or can't be queried)
- Were created less than 30 days ago
- Have fewer than 1000 weekly downloads

A flagged package isn't necessarily wrong, but it requires explicit
acknowledgment in the PR description before merge.

Rust dependencies are covered by `cargo audit` in CI (RUSTSEC advisories)
plus Dependabot's `cargo` ecosystem — crates.io has no equivalent
hallucination-age heuristic wired up; adding a crate still warrants a
manual look at its repository and download count.

## 5. Test-first is hook-enforced for high-risk paths

For paths under active multi-phase development, a Claude Code PreToolUse
hook in `.claude/hooks/` blocks `Write`/`Edit` on production source
files unless a sibling `*.test.ts` exists. This is structural enforcement
of `.claude/rules/10-tdd.md`, not a replacement for it.

Currently scoped to:
- `src/lib/ghaWorkflow/**`
- `src/lib/workflowRouting/**`
- `src/components/Editor/WorkflowPanel/**`
- `src/components/Editor/WorkflowEditor/**`
- `src/plugins/githubWorkflow/**`
- `src/stores/workflowViewStore.ts`
- `src/stores/workflowEditStore.ts`

Allow-list within scope: `*.test.ts(x)`, `types.ts`, `*.d.ts`, `*.css`.

To extend the scope to a new feature path, edit the `SCOPED` array in
`.claude/hooks/gha-tdd-guard.mjs` (rename or add a parallel hook for
larger features).

## 6. Cross-model review at risk points

Use `/cc-suite:review-plan` against any plan exceeding ~500 lines or
spanning >3 phases before starting Phase 1. Codex (different training data,
different blind spots) catches package-name hallucinations and API
assumptions that a single-model review will miss. This is mandatory for
plans that introduce new external dependencies.

## 7. Spike before commit on high-risk technology choices

When a plan ADR rests on an unverified assumption about an external library,
a Phase 0 spike (under `dev-docs/grills/<feature>/`) must validate the
assumption with a runnable probe before any other phase commits. The
GitHub Actions workflow viewer plan's Phase 0 (4 spikes, 100% PASS) is the
template.

## 8. Subagent context isolation

Every frontier model degrades from ~300k tokens (Chroma 2025), well below
the 1M ceiling. For verbose tasks (search, audit, research), dispatch a
subagent rather than letting the main thread accumulate context. Use:

| Task class | Subagent |
|---|---|
| Open-ended search across the codebase | `Explore` |
| Multi-source web research | `coding-researcher` |
| Independent plan/code review | `cc-suite:review-plan`, `auditor` |
| Implementation of a single scoped WI | `execution-agent` or `implementer` |

Aggressive `/clear` between unrelated tasks; new session per phase.

## 9. Don't bypass; ask

If a hook or gate blocks legitimate work, fix the gate rather than skip
it. `--no-verify` on `git commit` or `git push`, removing the hook from
`.claude/settings.json`, or changing the WI-linkage script's regex are all
forbidden without explicit user authorization. Document the bypass reason
if granted.

## 10. `main` and release tags are gated at push time

CI (`.github/workflows/ci.yml`) runs `pnpm check:all` and exposes the
required `frontend` check, which gates **PR merges**. It does **not** gate
**direct pushes** to `main`: `on: push` CI runs *after* the commit already
landed, and a repo owner can push straight to `main` (a local
`git merge --no-ff`, or `/bump … and release`) with bypass permission. That
is how the content-server merge (`e2a0dffe`) reached `main` with a red gate —
knip, the actionRegistry contract test, and function coverage were all
failing, mutually masked, and nothing blocked the push.

The structural fix is a versioned `pre-push` hook (`.githooks/pre-push`):
before any push that updates `main` or a `v*` tag, it runs a Windows
cross-target compile check (`scripts/check-cross-target.sh` — host-only
cargo can't see `cfg(target_os)` breakage; the v0.8.26 release push hit
that class 4× in a row), then `cargo clippy … --all-targets -- -D warnings`
(the same lint CI's `rust-test` job runs — a clippy `-D warnings` violation
in `src/browser/*` reached `main` red because `pnpm check:all` is
frontend-only and never runs clippy), and finally `pnpm check:all`, refusing
the push on any failure. The cross check soft-skips (warning, not block) when
the mingw-w64 toolchain isn't installed — CI stays the authoritative
cross-platform gate; the clippy gate is a hard block (the host toolchain
always has clippy). Feature-branch pushes are not gated locally.
The hook is enabled by `git config core.hooksPath .githooks`, which the root
`package.json` `prepare` script applies on `pnpm install` (no husky
dependency). Overriding it (`git push --no-verify`) falls under §9.

**Residual control (owner-only, GitHub settings — not enforceable from the
repo):** to close the bypass entirely, enable branch protection on `main`
with *Require a pull request before merging*, *Require status checks to pass*
(`frontend`, `rust`), and *Do not allow bypassing the above settings* / no
direct-push allowance for admins. Until that is set, the `pre-push` hook is
the only thing standing between a red local gate and `origin/main`.
