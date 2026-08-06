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
manifest (root, `server/mcp/`, `website/`) runs
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

| Feature | Paths |
|---|---|
| GHA workflow viewer | `src/lib/ghaWorkflow/**`, `src/components/Editor/WorkflowPanel/**`, `src/components/Editor/WorkflowEditor/**` |
| Bespoke workflow engine | `src/lib/workflow/**`, `src/plugins/workflowPreview/**`, `src/components/WorkflowApproval/**`, `src/services/workflow/**`, `src/stores/workflowStore.ts` |
| Source-pane workflow extensions | `src/plugins/codemirror/` modules whose name matches `*[Ww]orkflow*` or `*Gha*` (covers `sourceGhaIrSync.ts`; the guard's test globs the directory so a new workflow module cannot silently escape) |
| Embedded browser | `src/lib/browser/**`, `src/lib/sites/**`, `src/components/Browser/**`, `src/services/browser/**`, `src/stores/browserApprovalStore.ts` |
| Browser automation (MCP handlers) | `src/services/mcpBridge/v2/browser*` |

Allow-list within scope: `*.test.ts(x)`, `types.ts`, `*.d.ts`, `*.css`.

To extend the scope to a new feature path, edit the `SCOPED` array in
`.claude/hooks/gha-tdd-guard.mjs` (rename or add a parallel hook for
larger features).

**Every scoped path must exist, and the hook's own test asserts it.** Until
WI-19 the array named `src/lib/workflowRouting/**`, `src/plugins/githubWorkflow/**`,
`src/stores/workflowViewStore.ts`, `src/stores/workflowEditStore.ts` and
`src/stores/webWorkflowStore.ts` — none of which had existed for months — while
the shipped workflow-engine frontend (`src/lib/workflow/`,
`src/plugins/workflowPreview/`, `src/stores/workflowStore.ts`) was outside the
scope entirely, and the MCP browser handlers had moved `hooks/` → `services/`
in WI-10 without the pattern following. A guard aimed at deleted paths reports
the same green as a guard that works. `gha-tdd-guard.test.mjs` now pins both
directions: an untested probe inside each real scope is blocked, and each
removed path is NOT — so a resurrected name has to be re-scoped deliberately
rather than inherited.

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

The structural fix was a versioned `pre-push` hook (`.githooks/pre-push`)
that re-ran the full local gate — a Windows cross-target compile check
(`scripts/check-cross-target.sh` — host-only cargo can't see
`cfg(target_os)` breakage; the v0.8.26 release push hit that class 4× in a
row), then `cargo fmt … --check` and
`cargo clippy … --all-targets -- -D warnings` (the same rustfmt + lint CI's
`rust-test` job runs — BOTH a clippy `-D warnings` violation AND a whole-module
rustfmt drift in `src/browser/*` reached `main` red because `pnpm check:all` is
frontend-only and runs neither; CI's Format check is Linux-only, so the macOS
leg never caught the drift), and finally `pnpm check:all` — on every
`main`/`v*` push. Once the residual control below made the remote itself
authoritative for `main`, the hook was reworked (WI-7, 2026-08-03; §9 —
fixing the gate, not bypassing it) from proxy to property:

- **Tag leg (`v*`)** — the real gate, since branch protection cannot gate
  tag pushes: the hook runs `scripts/check-tag-green.sh <tagged commit>`,
  a seconds-fast `gh api …/check-runs` verification that the required
  checks (`frontend`, `rust`) are `completed`+`success` on the exact SHA
  the tag names. Latest run per check name wins (re-run-to-green passes);
  pending, failed, or missing checks refuse the push; `gh` missing, a
  network error, or malformed JSON also refuse (fail closed) — never a
  silent pass.
- **Main leg** — informational only: branch protection rejects any direct
  push of a commit its required checks have not passed, so a local re-check
  would duplicate the remote and spuriously block legitimate fast-forward
  pushes (a fresh merge commit's own `on: push` runs have not started yet).
- **`VMARK_OFFLINE_GATE=1`** — runs the full legacy local gate above
  instead, for both legs, when gh/network is unavailable. The cross check
  soft-skips (warning, not block) when the mingw-w64 toolchain isn't
  installed — CI stays the authoritative cross-platform gate; the fmt and
  clippy gates are hard blocks. Timing for both modes lives in the hook's
  header — the single authoritative claim; docs reference it rather than
  restating numbers.

Feature-branch pushes are not gated locally.
The hook is enabled by `git config core.hooksPath .githooks`, which the root
`package.json` `prepare` script applies on `pnpm install` (no husky
dependency). Overriding it (`git push --no-verify`) falls under §9.

**CI is `pull_request`-only, and `strict: true` is what makes that safe
(2026-08-05).** `ci.yml` used to trigger on `push: [main]` as well, so every
change was verified TWICE against byte-identical trees. Measured on v0.9.28:
PR head `635b7dd7` and merge commit `7e89a426` both had tree `0e15a780`. The
duplicate cost ~57 runner-minutes per change and — worse — it gated releases,
because `check-tag-green.sh` reads check-runs on the tagged commit and so sat
waiting ~22 min for a re-run to reconfirm bytes CI had already passed.

Three pieces now hold the property "every commit on `main` was verified as the
exact tree it is", and **all three are load-bearing** — removing any one
reintroduces a real hole:

1. **`strict: true`** on the required checks (added 2026-08-05). The PR branch
   must contain main's tip before merging, so the merge commit's tree equals
   the PR head's, and the PR's run tested precisely what lands. Without it, a
   PR verified against a stale `main` could land a combination nothing tested —
   and there is no longer a push-triggered run to catch it. **If this is ever
   turned off, restore `push: [main]` in `ci.yml` in the same change.**
2. **`enforce_admins: true` + required `frontend`/`rust`** — nothing reaches
   `main` outside that path, including for the repo owner.
3. **`check-tag-green.sh` resolves an identical-tree ancestor.** A merge commit
   has no check-runs of its own now, so the gate walks (bounded) to a commit
   with an IDENTICAL TREE and requires the real green checks there. Tree
   equality, not ancestry, is the argument — "some ancestor passed" would be
   meaningless, and `scripts/check-tag-green.test.mjs` pins the refusal of a
   green ancestor whose tree differs. With no `git` on PATH the candidate list
   collapses to the tagged commit alone, i.e. the older, STRICTER behaviour —
   degradation can only tighten this gate, never loosen it.

Do NOT "fix" a slow release by making the gate accept a status that CI could
have stamped for free; the point is that it verifies a real test result.

To inspect or revert the strictness:
```bash
gh api repos/xiaolai/vmark/branches/main/protection --jq .required_status_checks.strict
```

**Residual control — ENABLED 2026-07-27.** The hook was never the whole story:
`main` had required status checks (`frontend`, `rust`) but `enforce_admins:
false`, so an owner push sailed past them with
`remote: Bypassed rule violations for refs/heads/main`. The v0.9.15 push did
exactly that, and CI then went red on a Windows-only test assertion the local
gate cannot see (`check-cross-target.sh` COMPILES for Windows; it does not run
the suite there).

`main` now carries:
- required status checks `frontend` + `rust`,
- `enforce_admins: true` — admins are subject to them,
- a pull request required before merging, with
  `required_approving_review_count: 0` so a solo maintainer can self-merge once
  the checks are green,
- deletions blocked, and force-push blocked by the separate `main-no-force-push`
  ruleset (`bypass_actors: []`, `current_user_can_bypass: "never"`).

**Consequence for releases:** a direct `git push origin main` of a new commit is
now REJECTED — required checks cannot have passed on a commit the remote has
never seen. The bump must go through a PR; see `40-version-bump.md`. Tag pushes
are unaffected, so the release trigger is unchanged.

To inspect or revert:
```bash
gh api repos/xiaolai/vmark/branches/main/protection
gh api -X DELETE repos/xiaolai/vmark/branches/main/protection   # removes it entirely
```

## 11. Committed baselines are re-checked against the merge base

Every ratcheting gate (`file-size`, `knip`, `bespoke-buttons`,
`extension-budget`, `command-errors`, `store-coupling`, `i18n`,
`mock-boundaries`, `shell-slots`, `merge-drops`, dependency-cruiser
known-violations) compares the tree against its baseline **in the same
commit**. On its own that is self-attestation: raise the number and change the
code together and every gate reports green. With
`required_approving_review_count: 0`, no human review structurally stands
between that and `main`.

`scripts/check-baseline-ratchet.mjs` closes it for all of them. A manifest
inside the script names every baseline and how its loosening is defined —
`scalar`, `per-key-count`, `identity`, or a named `custom` comparator — and CI
re-reads each one at the **merge base**, history the PR cannot have written.
Two-way staleness is enforced in both directions: a baseline-shaped file on
disk that is not in the manifest fails, and a manifest entry whose file is gone
fails. **Registering a new baseline in the manifest is part of adding it**, not
a follow-up.

Prefer **identity** baselines over counts wherever the checker can emit them: a
count permits a like-for-like swap (drop one violation, add a different one,
total unchanged, gate silent) — the defect this gate exists to kill.

Two properties worth knowing before it surprises you:

- **It is a CI-tier gate, deliberately absent from `pnpm check:all`.** The
  comparison needs a base ref, which a local checkout cannot guarantee
  (detached HEAD, stale remote, shallow clone, no network). It runs on
  `pull_request` in `ci.yml` and **fails closed** when the base ref cannot be
  resolved — it never skips. Run it by hand with
  `node scripts/check-baseline-ratchet.mjs origin/main`.
- **A genuine re-measurement uses `allowRaise`, which expires.** When a gate is
  rebuilt and the new number is honestly higher (WI-8 replaced 17 plugin-wide
  dependency-cruiser licenses with 74 individually frozen edges), a manifest
  `allowRaise` entry permits exactly that one from→to, requires a stated
  reason, and **fails as stale** once the base already carries the raised
  value. The PR after the re-measurement lands must delete it.

## 12. Dark-feature verdicts (proposed by WI-19, awaiting maintainer ratification)

Two of the three largest investments in this codebase — the embedded browser
(~17.7k LOC) and the workflow system (~17.8k LOC) — ship default-off. A feature
that is neither on nor deleted accrues cost in both directions: it is carried by
every refactor, every dependency bump and every gate, and it earns nothing. Each
paragraph below is a recommendation grounded in what the code shows today
(completeness, test coverage, guard state), not a decision. **The maintainer
ratifies or overrides; until then these are proposals.** Each carries a dated
exit criterion, because "we'll decide later" is how a dark feature becomes
permanent.

**Embedded browser — KEEP DARK, exit criterion 2026-11-01.** This is the most
finished of the three and the only one with real backend enforcement: the AI
commands are `CommandError`-typed, every refusal has a test naming its `code`
(`browser/ai_guards.test.rs`), the SSRF/LAN destination policy is adversarially
tested down to legacy IPv4 spellings, and the approval flow, origin grants and
policy epochs all exist and are pinned. What is missing is not code but
evidence: it is macOS-only by construction (every other platform's native
surface is an explicit unsupported stub), the website already calls it "an
early, OPT-IN feature", and nothing in the repo records a single user having
turned it on. The recommendation is therefore to leave `browser.enabled` off,
keep the guard scope, and set a dated decision point: by **2026-11-01**, either
a Windows/Linux surface exists (making default-on defensible) or the feature is
extracted behind a cargo feature so a build that does not want it does not pay
for it. Shipping it on by default today would make the SSRF policy a
default-exposed attack surface on the primary platform in exchange for a
capability no one has asked for.

**Workflow VIEWER — SHIP ON BY DEFAULT (partly already true), exit criterion
2026-09-15.** The GitHub Actions surface is the healthiest thing in this review:
27 of 29 modules in `src/lib/ghaWorkflow/` carry sibling tests, `WorkflowPanel/`
and `WorkflowEditor/` are at 100% file-level test coverage, and it has real
users' files to work on — every repo that uses CI has `.github/workflows/*.yml`.
It is also *already* on by default in its main form: the yaml adapter registers
the `gha-workflow` schema renderer unconditionally, so opening a workflow file
gives you the workbench with no flag at all. What was gated was the source-pane
help — expression completion, cursor↔canvas sync, `uses:` goto-def — and it was
gated behind an *execution engine* flag, which is why WI-19 split it into
`advanced.workflowViewer`. The recommendation is to flip that flag's default to
`true` once one release has shipped with the split (so the migration has run
everywhere) — by **2026-09-15**. The risk is small and bounded: these extensions
are read-only, they no-op on non-YAML files, and the workbench they assist is
already unconditional.

**Workflow ENGINE — EXTRACT, exit criterion 2026-10-01.** The bespoke YAML
runner is the weakest case of the three and the one with the most machinery per
unit of demonstrated demand. It executes a workflow language VMark invented,
spawns AI providers, writes files, and takes filesystem snapshots — and until
WI-19 the Rust side did none of that behind a flag check, so anything that could
reach the IPC boundary ran it regardless of the setting. Its frontend is thinner
than the viewer's (`src/plugins/workflowPreview/WorkflowPreview.tsx` still has
no test), it duplicates a capability the AI genies already provide for the
single-step case, and its "language" competes with the GitHub Actions syntax the
viewer half of the same feature already speaks fluently. The recommendation is
**extract**: move the runner (`src-tauri/src/workflow/`, `src/lib/workflow/`,
`src/plugins/workflowPreview/`, `src/components/WorkflowApproval/`) behind a
cargo feature plus a build-time frontend flag by **2026-10-01**, so a default
build carries neither the code nor its dependency surface. If, by that date,
usage evidence argues for keeping it in-tree, the fallback is to keep it dark
with the WI-19 backend gate — which is now real enforcement rather than a hidden
button — and re-review at the next architecture pass. Deleting it outright is
not proposed: `run_workflow` is what genie workflows dispatch through, so
removal is a migration, not a deletion.

**What the WI-19 gate does and does not claim (audit 20260803 §4).** Both
flags reach Rust the same way: the webview PUSHES them
(`workflow_engine_policy`, `browser_ai_policy`) because settings live in
localStorage, which Rust cannot read. That makes each an unauthenticated
boolean IPC setter, and reviewers keep re-flagging it as "bypassable". The
verdict is that it is not a weakness, because of what the gate is for. It
buys one property: a **UI-less path** — the MCP bridge, a second window, a
replayed invoke — cannot execute a dark feature the user switched off. It
claims nothing against a caller that can already invoke Tauri commands in
this process: such a caller runs at the app's own privilege, is inside the
trust boundary by definition, and could call `run_workflow` directly if the
flag were not consulted at all. Persisting the flag Rust-side would move the
toggle, not the boundary, and would add a second source of truth for a
setting the frontend owns. Do not "fix" this by rebuilding persistence.

The one thing the gate must NOT do is refuse to *stop* things. Gating
`cancel_workflow` and `respond_workflow_approval` made a running workflow
unstoppable by the user who had just turned the feature off — the panel with
the cancel button disappeared and the command started returning
`feature-disabled`. Only commands that START work are gated; the `false`
transition of the setter now also asks any in-flight run to stop.
`workflow/guards.test.rs` pins both halves against the real source.
