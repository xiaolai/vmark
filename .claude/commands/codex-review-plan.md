---
description: Send a plan to Codex for architectural review — checks consistency, completeness, feasibility, ambiguity, and risk
---

## User Input

```text
$ARGUMENTS
```

## What This Does

Sends a plan document to Codex running in an isolated context for independent review. Codex reads the plan (and optional context files), then evaluates it across 5 dimensions that matter for plans — not code quality, but **buildability**.

## Model & Settings Selection

Follow the instructions in `commands/_model-selection.md` to discover available models and present choices.

- **Recommended model**: `gpt-5.3-codex`
- **Recommended reasoning effort**: `high`
- **Include sandbox question**: No (plan review always uses `read-only`)

## Workflow

Use TodoWrite to track progress:

```
☐ Determine plan file and context files
☐ Ping Codex availability
☐ Send plan for review
☐ Present findings to user
```

### Phase 1: Determine Scope

Parse `$ARGUMENTS` to find the plan:

| Input | Interpretation |
|-------|----------------|
| (empty) | Look for `dev-memo/plan.md`, then `plan.md`, then ask |
| `path/to/plan.md` | Use that file |
| `path/to/plan.md +context1.md +context2.md` | Plan file + additional context files |

Read the plan file. If it references other documents (design docs, specs, AGENTS.md), read those too — they become context.

### Phase 2: Availability Test

Ping Codex before the real call:

```
mcp__codex__codex with:
  prompt: "Respond with 'ok' if you can read this."
  model: {chosen_model}
  config: {"model_reasoning_effort": "{chosen_effort}"}
```

If Codex does not respond or errors out, skip to **Phase 4: Fallback** immediately. Do not retry.

### Phase 3: Send Plan for Review

Send a SINGLE Codex call with the full plan. Plans are conceptual documents — unlike code audit, there's no need to split by file.

```
mcp__codex__codex with:
  model: {chosen_model}
  config: {"model_reasoning_effort": "{chosen_effort}"}
  sandbox: read-only
  approval-policy: on-failure
  developer-instructions: "You are an architecture reviewer evaluating plan feasibility."
  prompt: |
    Read these files, then evaluate the plan
    across all 5 dimensions below. Be critical — flag anything that would cause problems
    during implementation.

    Files to read:
    - {plan_file}
    - {context_files...}

    ## Dimension 1: Internal Consistency

    Do decisions contradict each other? Examples:
    - Decision A says X, but Decision B requires not-X
    - A data model field is defined in one section but used differently in another
    - A component is described as stateless in one place, stateful in another
    - Dependency flow says A→B, but code shows B→A

    ## Dimension 2: Completeness

    What's missing? Look for:
    - Error paths: what happens when X fails? Every async operation needs a failure path.
    - Startup/shutdown: is initialization order defined? Graceful shutdown?
    - Edge cases: empty states, first-run, concurrent access, restart recovery
    - Migration: how do you go from nothing to a working system?
    - Configuration: are all required settings documented?

    ## Dimension 3: Feasibility

    Can this actually be built as described?
    - Are the APIs/SDKs used correctly? (Check against actual SDK docs if you know them)
    - Are there technology mismatches? (e.g., sync API used in async context)
    - Are performance assumptions realistic? (e.g., "SQLite handles it" — at what scale?)
    - Are there undeclared dependencies or missing infrastructure?

    ## Dimension 4: Ambiguity

    Where would an implementer get stuck?
    - Vague specs: "the system should handle this" — how exactly?
    - Undefined behavior: what happens in situation X? The plan doesn't say.
    - Multiple valid interpretations: a sentence that two developers would implement differently
    - Missing examples: complex behaviors described in prose without concrete examples

    ## Dimension 5: Risk & Sequencing

    What's the hardest part, and is the build order correct?
    - High-risk items buried late in the plan (should be addressed early)
    - Dependencies between phases that aren't acknowledged
    - Single points of failure with no fallback
    - Integration risks: components designed in isolation that must work together

    ## Output Format

    For each dimension, report findings as:

    **[Dimension N: Name]**
    | # | Severity | Finding | Location | Recommendation |
    |---|----------|---------|----------|----------------|
    | 1 | High/Med/Low | What's wrong | Section/Decision ref | How to fix |

    Then provide:

    **Overall Verdict**: READY TO BUILD / NEEDS REVISION / MAJOR GAPS

    **Top 3 Risks** (ordered by impact):
    1. ...
    2. ...
    3. ...

    **Strongest aspects** of the plan:
    - ...
```

### Phase 4: Fallback — Manual Review

**CRITICAL**: If Codex returns empty/no findings, perform the review yourself.

1. **Read the plan** using the Read tool
2. **Walk through all 5 dimensions** as described above
3. **Cross-reference**: for each decision, check if it conflicts with any other decision
4. **Trace data flow**: follow a message from input to output — does every step exist?
5. **Report findings** in the same format as Phase 3

**Do NOT say "Codex didn't return findings" and stop. Always complete the review.**

### Phase 5: Present Findings

Display Codex's review to the user. Add your own assessment if you disagree with any finding or notice something Codex missed.

Format as:

```markdown
# Plan Review

**Plan**: {filename}
**Model**: {chosen_model} | **Effort**: {chosen_effort}
**Thread ID**: `{threadId}` _(use `/codex-continue {threadId}` to iterate on findings)_
**Verdict**: READY TO BUILD / NEEDS REVISION / MAJOR GAPS

## Findings by Dimension

### 1. Internal Consistency
{findings table or "No issues found"}

### 2. Completeness
{findings table}

### 3. Feasibility
{findings table}

### 4. Ambiguity
{findings table}

### 5. Risk & Sequencing
{findings table}

## Top Risks
1. ...
2. ...
3. ...

## Strengths
- ...

## Additional Notes
{Any additional observations, agreements, or disagreements with Codex's review}
```
