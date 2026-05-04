# AI-Driven Coding Governance: Field Practices, 2024–2026

> Created: 2026-05-04
> Source: research synthesis (web sources, primary papers, vendor blogs, practitioner reports)
> Purpose: capture what's emerged for keeping AI-assisted implementation honest, so VMark's governance choices have an evidentiary base. Companion to the GHA workflow viewer plan and to future plans of similar scope.

## Why this document exists

Long-running AI-assisted implementation has four distinct failure modes:

1. **Drift** — implementation diverges from a written plan over phases.
2. **Hallucination** — LLM invents APIs, packages, file paths, conventions that don't exist.
3. **Partial work** — features declared "done" with components or wiring missing.
4. **Bug introduction** — regressions in untouched code, broken cross-cutting concerns.

The mechanisms differ; the defenses must too. This file collects the specific
practices that have actually shipped and shown effect, with citations.

---

## Top 5 most-validated practices

1. **Hard gates as code, not prose.** Claude Code hooks (PreToolUse/PostToolUse), git pre-commit, and CI checks that exit non-zero stop the agent before bad output ships. TDD Guard is the canonical example: a PreToolUse hook that blocks `Write`/`Edit` unless a failing test exists. Hooks are **deterministic** — the agent literally cannot bypass them. ([Claude Code Hooks reference](https://code.claude.com/docs/en/hooks); [TDD Guard](https://github.com/nizos/tdd-guard))

2. **Spec-Driven Development with phase gates.** GitHub's Spec Kit (Sept 2025) formalizes `/specify` → `/plan` → `/tasks` → `/implement` with checkpoint approvals between phases. The contract is the spec, not the chat log. ([github/spec-kit](https://github.com/github/spec-kit); [GitHub blog: SDD](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/))

3. **Subagents with isolated context windows.** Chroma's 2025 study confirmed every frontier model degrades from ~300k tokens, well below the 1M ceiling. Anthropic's Opus-lead + Sonnet-subagent architectures beat single-Opus by 90.2% on research tasks. The fix for drift in long sessions is **not** a longer window; it's **more, smaller windows**. ([Chroma context-rot](https://research.trychroma.com/context-rot); [Anthropic engineering](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills))

4. **Mutation testing to validate AI-written tests.** Meta's ACH system (Sept 2025) showed LLM-written tests routinely pass without catching real bugs ("wiring-only tests"). Mutation testing closes that loop. Engineers accepted 73% of ACH's mutation-driven tests. ([Meta engineering](https://engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance/); [Mutahunter](https://github.com/codeintegrity-ai/mutahunter))

5. **Verify package existence before import.** Package hallucination rate is **5.2% commercial / 21.7% open-source** (USENIX Security 2025, n=576k samples). 43% of hallucinations repeat across re-runs, enabling "slopsquatting" supply-chain attacks. Pin lockfiles, run dependency scanners on every agent commit. ([USENIX 2025](https://www.usenix.org/system/files/conference/usenixsecurity25/sec25cycle1-prepub-742-spracklen.pdf); [Socket: slopsquatting](https://socket.dev/blog/slopsquatting-how-ai-hallucinations-are-fueling-a-new-class-of-supply-chain-attacks))

---

## A. Spec-driven development frameworks

**GitHub Spec Kit** (Sept 2025, MIT) is the most-adopted SDD toolkit. Four
gated phases: `/constitution` (project principles) → `/specify` (what & why)
→ `/plan` (architecture, stack, constraints) → `/tasks` (small reviewable
units) → `/implement` (code with tests + DoD). Works with Copilot, Claude
Code, Gemini CLI. The novelty is the gated checkpoints, not the templates.

**Anthropic Skills** (open standard, Dec 18 2025) — directories with YAML
frontmatter that load progressively (~100 tokens at session start, full body
only when relevant). Adopted by 32 tools as of March 2026 including Codex
CLI, ChatGPT, Cursor, Gemini, Junie, Goose, Amp. The de-facto cross-tool
format.

**Aider's CONVENTIONS.md + repo map** uses a graph-ranking algorithm
(PageRank-style on the import graph) to send only the most relevant symbols,
not whole files. Conceptually closer to RAG than to context dumping. The
pattern most other tools' "smart context" features descend from.
([Aider repo map docs](https://aider.chat/docs/repomap.html))

**Cursor rules evolution**: `.cursorrules` (single file, 2023) → `.cursor/rules/*.mdc`
(scoped to globs, 2024–2025). Glob scoping matters — rules apply per file
pattern. ([Cursor Rules docs](https://cursor.com/docs/rules))

**Honest assessment**: SDD is widely adopted but value depends entirely on
whether the gates are enforced. A spec without a CI-checked DoD is just
more prose.

## B. Drift detection — what actually ships

**There is no widely-adopted automated plan-vs-code drift detector** as of
mid-2026. Most "drift detection" tools listed in vendor blogs are
positioning, not products with shipping diff-checkers.

What does exist:

- **Agent Decision Records (AgDR)** — extends ADRs for agent-made choices,
  with pre-commit hooks that enforce creation. Niche but principled.
  ([me2resh/agent-decision-record](https://github.com/me2resh/agent-decision-record))
- **LLM-as-judge for ADR violations** — academic work using multi-LLM
  pipelines to flag architectural violations. Research-stage.
  ([arXiv 2602.07609](https://arxiv.org/abs/2602.07609))
- **Living plan files in `dev-docs/plans/`** — Anthropic's own teams use
  this. The trick is referencing work-item IDs (`WI-12`) in commit messages
  and PR titles so a `grep` rebuilds the trace. Manual but effective.
  ([Anthropic: How teams use Claude Code (PDF)](https://www-cdn.anthropic.com/58284b19e702b49db9302d5b6f135ad8871e7658.pdf))

**What works in practice**: a CI script that greps every plan WI-ID and
verifies (a) the WI is mentioned in at least one commit, (b) the DoD
assertions for that WI pass. ~50 lines of shell, not a product.

## C. Hallucination defenses for code

**Primary data** — USENIX 2025, Spracklen et al., 576,000 samples: 5.2%
commercial / 21.7% open-source hallucination rate. **205,474 unique fake
package names**. 43% repeat across re-runs.

**Defenses ranked by effectiveness**:

| Defense | Effectiveness |
|---|---|
| Pinned lockfiles + dep scanner in CI | High — blocks the install, not the code |
| Tool-grounded import: agent calls `npm view`/`pip index` first | High but token-expensive |
| RAG over project source for in-repo symbols | High |
| Cross-model adversarial review (e.g., Codex reviews Claude) | Moderate — different blind spots catch each other |
| Static analysis for unresolved imports | Moderate — catches obvious cases only |

**Slopsquatting** ([Socket](https://socket.dev/blog/slopsquatting-how-ai-hallucinations-are-fueling-a-new-class-of-supply-chain-attacks))
is the supply-chain weaponization. Term coined by Seth Larson (PSF). Active
attack vector as of 2025.

**SWE-Bench Pro data** ([arXiv 2509.16941](https://arxiv.org/abs/2509.16941))
on long-horizon failure modes:
- Frontier models (Opus 4.1, GPT-5) fail mostly on *semantic understanding*
- Sonnet 4 specifically fails on *context overflow + endless file reading*
- Open-source models fail on *tool use*

If you see endless `Read`/`Grep` chains, that's a context-management failure
mode, not a model-intelligence failure.

## D. TDD-style enforcement

**[TDD Guard](https://github.com/nizos/tdd-guard)** (active 2025) — the
canonical tool. PreToolUse hook for Claude Code that:
1. Blocks `Write`/`Edit` unless a failing test exists for the target.
2. Blocks over-implementation (writing more than the test requires).
3. Multi-language: TS/JS, Python, PHP, Go, Rust.

The win is structural — it's not advice, it's a hook that returns exit
code 2 and stops the tool.

**Mutation testing** is the second leg:
- **Meta ACH** — 9,095 mutants generated across 10,795 Kotlin classes; 73%
  test acceptance rate.
  ([engineering.fb.com](https://engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance/))
- **Mutahunter** — open-source, language-agnostic.
  ([codeintegrity-ai/mutahunter](https://github.com/codeintegrity-ai/mutahunter))
- **Atlassian** reported 70% time savings reaching 80% mutation coverage.

**Property-based testing** for LLM verification: 30–32% of LLM solutions
only *partially* satisfy correctness properties even when unit tests pass.
PBT catches what example-based tests miss. Hypothesis (Python),
fast-check (TS), proptest (Rust). ([arXiv 2506.18315](https://arxiv.org/abs/2506.18315))

## E. Phase-boundary gates

**Claude Code hooks** — 12 lifecycle events. The three that matter for
governance:

- **PreToolUse** — exit 2 to block the tool call (the only true hard gate).
- **PostToolUse** — inject feedback into agent context after a tool ran.
- **Stop / StopFailure** — final-turn validation.

Pattern: PreToolUse for *prevention*, PostToolUse for *correction*. A
PostToolUse hook that runs `pnpm typecheck` and feeds errors back lets the
agent self-correct without human intervention.

**CI patterns** for multi-phase plans:
- Each phase has a tag/branch.
- DoD checks run as required GitHub status checks.
- Phase tick is a PR merge, not a plan-file edit.
- Use `gh pr checks --required` to enforce.

## F. Anti-partial-work patterns

**Vertical slices** — every WI must end with a user-visible working surface.
The anti-pattern is "Phase 1: data layer, Phase 2: business logic, Phase 3:
UI" — Phase 1 ships, declares done, but you can't actually verify it in
product.

**Feature flags** — wrap AI-generated code, deploy dark, observe, then
enable. Cost: discipline to *remove* flags after rollout. Dead branches are
the silent killer. CI check that lints flag age (>90 days = error).
([devcycle](https://blog.devcycle.com/who-knew-feature-flags-would-save-ai-coding/))

**Machine-checkable DoD** — a `dod.yaml` per WI containing executable
assertions (shell commands, test names, type-check outputs, lint rules).
The phase gate runs the file. If anything fails, the phase doesn't tick.
This is what differentiates real DoD from a Notion checkbox.

**Dead code linting** — `ts-prune`, `vulture`, `cargo-udeps`. Add to CI;
partial work usually leaves orphan exports.

## G. Tools — strengths and failure modes

| Tool | Strength | Failure mode |
|---|---|---|
| Claude Code | Hooks, skills, plan mode, subagents | Sonnet variants prone to context-overflow on multi-file tasks |
| Codex CLI | ChatGPT auth, skills support | Less mature governance tooling |
| Aider | Repo map, CONVENTIONS.md, terminal-native | Single-pair-programmer model; weak for parallel work |
| Cursor | Fast iteration, good rules system | "Confident hallucination at architectural level" reported |
| Devin | Fully autonomous | **Failure post-mortem**: Answer.AI evaluated 20 tasks → 14 failures, 3 successes (Jan 2025); 13.86% on SWE-bench Lite. Cognition's own [2025 review](https://cognition.ai/blog/devin-annual-performance-review-2025) admits autonomous-by-default "collided with reality" |
| OpenHands | OSS, V1 SDK with critic, parallel workers | Setup overhead; benchmark-focused |

**Notable post-mortem**: The Register's Jan 2025 Devin coverage is the most-
cited reality check on full autonomy. The lesson: **autonomous time-boxing
is essential** — agents will spend days pursuing impossible solutions if
not stopped.

## H. What experienced engineers report works

Distilled from Simon Willison, Addy Osmani, Anthropic's internal usage doc,
HN threads on State of AI Coding 2025:

**Survives contact with reality:**
- Plan-then-implement: write the plan, save as meta-program, implement step
  by step.
- Aggressive `/clear` between unrelated tasks; new session per phase.
- CLAUDE.md / AGENTS.md as living conventions doc, not aspirational rule book.
- Subagents for verbose tasks (search, audit) so the main context stays clean.
- Tests as primary contract; AI generates code, you write or audit the test.
- Senior-engineer skills (system design, knowing what to automate) are
  *more* valuable, not less.

**Hype that didn't survive:**
- "Vibe coding" for production — universally panned by mid-2025.
- Full autonomy (Devin model).
- Single-shot generation of large features — context rot kicks in around
  300–400k tokens.
- Generic "AI code review" tools without project-specific rules.

**Recurring practitioner complaint**: coding agents are good at
self-contained tasks, bad at distributed/microservice/cross-cutting work.
Boundary work is the persistent weak spot.

---

## VMark-specific application

VMark already has these pieces:
- TDD rule (`.claude/rules/10-tdd.md`)
- `pnpm check:all` gate (lint + tests + build + size)
- Codex-toolkit cross-model review
- Per-WI plan structure (`dev-docs/plans/*`)
- Coverage thresholds in `vitest.config.ts`
- Coding-researcher subagent
- Skills system (`vmark-mcp`, `plan-audit`, `plan-verify`)
- ui-tokenize, ui-responsive, docs-guardian, tdd-guardian plugins

What's missing or weak (in priority order):

1. **Hooks turn prose rules into hard gates.** TDD rule is currently
   advisory. Conversion to PreToolUse hook is the highest-leverage single
   change.
2. **Per-phase DoD as runnable scripts.** Today DoD lives as plan prose.
   `pnpm check:phase-N` per phase closes the partial-work loop.
3. **Plan↔code linkage via WI-ID grep.** Cheap and durable. Catches drift
   mechanically.
4. **Mutation testing on logic-heavy modules.** Wiring-only tests are the
   exact failure mode for stores, parsers, and reducers.
5. **Slopsquatting gate.** Pinned versions yes, but no Socket/Snyk-style
   scan on PR.

What NOT to add:
- **Devin-style full autonomy** — the clearest negative finding from the
  research.
- **A "drift detector" SaaS** — they don't exist as products. The 50-line
  WI-ID script does the same job.
- **Single-agent "longer context"** — context rot kicks in at ~300k.
  Subagent isolation is the actual fix.

---

## Sources

Primary:
- [GitHub Spec Kit](https://github.com/github/spec-kit)
- [GitHub blog: SDD](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/)
- [Anthropic: Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Anthropic: Best practices for Claude Code](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Anthropic: How teams use Claude Code (PDF)](https://www-cdn.anthropic.com/58284b19e702b49db9302d5b6f135ad8871e7658.pdf)
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code Sub-agents](https://code.claude.com/docs/en/sub-agents)
- [Aider repo map](https://aider.chat/docs/repomap.html)
- [Cursor Rules](https://cursor.com/docs/rules)
- [TDD Guard](https://github.com/nizos/tdd-guard)
- [Mutahunter](https://github.com/codeintegrity-ai/mutahunter)
- [Agent Decision Records](https://github.com/me2resh/agent-decision-record)
- [Cognition: Devin's 2025 review](https://cognition.ai/blog/devin-annual-performance-review-2025)

Research papers:
- [USENIX Security 2025: Package Hallucinations](https://www.usenix.org/system/files/conference/usenixsecurity25/sec25cycle1-prepub-742-spracklen.pdf)
- [arXiv 2509.16941: SWE-Bench Pro](https://arxiv.org/abs/2509.16941)
- [Chroma: Context Rot](https://research.trychroma.com/context-rot)
- [arXiv 2501.12862: Mutation-Guided LLM Test Generation](https://arxiv.org/abs/2501.12862)
- [arXiv 2506.18315: Property-Based Testing for LLM Validation](https://arxiv.org/abs/2506.18315)
- [arXiv 2501.19012: Importing Phantoms](https://arxiv.org/html/2501.19012v1)

Practitioner / industry:
- [Meta engineering: LLMs for mutation testing](https://engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance/)
- [Atlassian: Automating mutation coverage with AI](https://www.atlassian.com/blog/developer/automating-mutation-coverage-with-ai)
- [Socket: Slopsquatting](https://socket.dev/blog/slopsquatting-how-ai-hallucinations-are-fueling-a-new-class-of-supply-chain-attacks)
- [Simon Willison: ai-assisted-programming](https://simonwillison.net/tags/ai-assisted-programming/)
- [Addy Osmani: My LLM coding workflow into 2026](https://addyosmani.com/blog/ai-coding-workflow/)
- [Thoughtworks: Spec-driven development unpacked](https://www.thoughtworks.com/en-us/insights/blog/agile-engineering-practices/spec-driven-development-unpacking-2025-new-engineering-practices)
- [The Register: Devin reviews](https://www.theregister.com/2025/01/23/ai_developer_devin_poor_reviews/)
- [HN: State of AI Coding Report 2025](https://news.ycombinator.com/item?id=46301886)
- [AI Coding Agents Hallucination Tracker](https://hallucinationtracker.com/)
