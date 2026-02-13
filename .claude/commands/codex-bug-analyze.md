---
description: Analyze codebase to find root causes of user-described bugs and related issues using Codex
---

## Bug Description

```text
$ARGUMENTS
```

## Model & Settings Selection

Before starting analysis, present the user with choices using `AskUserQuestion`. Ask both questions at once:

**Question 1 — Model:**

| Model | Best for |
|-------|----------|
| `gpt-5.3-codex` | Flagship — deepest root cause analysis (Recommended) |
| `gpt-5.2-codex` | Previous gen — good for straightforward bugs |
| `gpt-5.1-codex-max` | Long-horizon — complex bugs spanning many files |

**Question 2 — Reasoning effort:**

| Level | Best for |
|-------|----------|
| `high` | Complex bugs — race conditions, subtle logic errors (Recommended) |
| `medium` | Straightforward bugs with clear symptoms |
| `low` | Obvious bugs where you just need confirmation |

## VMark Bug Context

**Tech stack**: Tauri v2 + React 19 + Zustand v5 + Vite v7
**Project layout**: `src/` (frontend React), `src-tauri/src/` (backend Rust)

**Common VMark bug patterns** — check these first:
- **Zustand stale reads**: `getState()` returning outdated values in callbacks/effects
- **Missing hook cleanup**: `useEffect` without cleanup for Tauri event listeners (`listen()`, `onEvent()`)
- **IPC race conditions**: Multiple rapid `invoke()` calls causing out-of-order responses
- **`error as Error` casts**: Unsafe error casting that hides real error types
- **MCP bridge issues**: Message serialization/deserialization failures between frontend and MCP server
- **File I/O on Windows**: Path separators, encoding, file locking differences

**High-risk areas** to prioritize during reconnaissance:
- `src-tauri/src/` — IPC handlers, file system operations, MCP server bridge
- `src/stores/` — Zustand stores, state management
- `src/components/editor/` — Editor core, plugin system
- `src-tauri/binaries/` — MCP server binary

## Analysis Strategy

Use TodoWrite to track progress:

```
☐ Parse bug description and identify symptoms
☐ Reconnaissance: identify relevant code areas
☐ Deep analysis: trace data flow and logic
☐ Root cause identification
☐ Related bug detection
☐ Generate analysis report
```

### Phase 1: Parse Bug Description

Extract from `$ARGUMENTS`:
- **Symptoms**: What behavior is observed?
- **Expected**: What should happen instead?
- **Context**: When/where does it occur?
- **Keywords**: Key terms to search for

### Phase 2: Reconnaissance

Identify scope using symptoms and keywords:

1. **Search for related code**:
   - Use Grep to find keywords from bug description
   - Use Glob to find relevant file patterns
   - Identify entry points and data flow paths

2. **Map the affected area**:
   - Which files/functions are involved?
   - What is the data flow?
   - What are the dependencies?

### Phase 3: Deep Analysis with Codex

**IMPORTANT**: Run Codex calls SEQUENTIALLY (one at a time).

**Availability test** — before the real analysis, send a short ping to Codex:
```
mcp__codex__codex with:
  prompt: "Respond with 'ok' if you can read this."
  model: {chosen_model}
  model_reasoning_effort: {chosen_effort}
```
If Codex does not respond or errors out, skip to **Phase 5: Fallback** immediately. Do not retry.

For each relevant file, run Codex:

```
mcp__codex__codex with:
  model: {chosen_model}
  model_reasoning_effort: {chosen_effort}
  sandbox: read-only
  approval-policy: never
  prompt: "Analyze {filename} for potential causes of this bug:

    BUG DESCRIPTION: {user's bug description}

    Investigate:

    1. **Logic Flow Analysis**
       - Trace the execution path related to the symptoms
       - Identify conditional branches that could cause the issue
       - Check loop conditions and termination
       - Look for off-by-one errors or boundary issues

    2. **State Management**
       - Check for race conditions or timing issues
       - Look for stale state or cache problems
       - Identify mutation of shared state
       - Check for async/await issues
       - VMark: Zustand getState() stale reads in callbacks/effects
       - VMark: Missing useEffect cleanup for Tauri event listeners

    3. **Data Flow**
       - Trace data transformations
       - Check type coercion or conversion issues
       - Look for null/undefined propagation
       - Identify truncation or overflow possibilities
       - VMark: IPC invoke() serialization/deserialization mismatches

    4. **Error Handling**
       - Check for swallowed exceptions
       - Look for missing error cases
       - Identify incomplete cleanup on failure
       - VMark: Unsafe 'error as Error' casts hiding real error types

    5. **Edge Cases**
       - Empty inputs, null values, zero values
       - Boundary conditions (min/max)
       - Concurrent access patterns
       - Resource exhaustion scenarios
       - VMark: Cross-platform path separators and file locking on Windows

    Report findings as:
    - LIKELY CAUSE: {description} at {file:line}
    - CONTRIBUTING FACTOR: {description} at {file:line}
    - RELATED RISK: {description} at {file:line}"
```

**Wait for each Codex call to complete before starting the next one.**

### Phase 4: Root Cause Identification

After analyzing all relevant files:

1. **Correlate findings** - Which issues appear across multiple files?
2. **Trace causality** - What triggers the chain of events?
3. **Identify the root** - What single change would prevent the bug?

### Phase 5: Related Bug Detection

Search for similar patterns that could cause related bugs:

```
mcp__codex__codex with:
  model: {chosen_model}
  model_reasoning_effort: {chosen_effort}
  sandbox: read-only
  approval-policy: never
  prompt: "Based on the root cause pattern found ({root cause}),
    search the codebase for similar patterns that could cause related bugs.

    Look for:
    1. Same anti-pattern in other files
    2. Similar logic that shares the same flaw
    3. Code that depends on the buggy behavior
    4. Copy-pasted code with the same issue

    Report each as:
    - RELATED BUG RISK: {file:line} - {description}"
```

### Phase 6: Generate Report

```markdown
# Bug Analysis Report

**Date**: {today}
**Bug**: {summary of user's description}
**Model**: {chosen_model} | **Effort**: {chosen_effort}

## Executive Summary

**Root Cause**: {one-sentence description}
**Confidence**: High / Medium / Low
**Complexity**: Simple fix / Moderate / Requires refactoring

## Symptoms Explained

{How the root cause manifests as the observed symptoms}

## Root Cause Analysis

### Primary Cause
| Location | Description | Evidence |
|----------|-------------|----------|
| {file:line} | {what's wrong} | {why we know} |

### Contributing Factors
| Location | Description | Impact |
|----------|-------------|--------|
| {file:line} | {issue} | {how it contributes} |

## Data/Logic Flow

```
{step-by-step flow showing where things go wrong}
```

## Related Bugs Found

| Location | Risk Level | Description |
|----------|------------|-------------|
| {file:line} | High/Med/Low | {potential bug} |

## Recommended Fix

### Immediate Fix
1. {specific action at file:line}
2. {specific action at file:line}

### Proper Fix (if different from immediate)
{Description of more thorough solution if band-aid vs proper fix differ}

### Test Cases to Add
1. {test case description}
2. {test case description}

## Prevention

How to prevent similar bugs:
- {coding practice}
- {review checklist item}
- {test strategy}
```

### Fallback: Manual Analysis

**CRITICAL**: If Codex returns empty/incomplete findings, perform manual analysis:

1. **Read each relevant file** using the Read tool
2. **Trace execution manually** following the bug symptoms
3. **Use Grep** to find related patterns:
   ```bash
   # Find similar patterns
   grep -rn "{key function or variable}" src/ src-tauri/src/

   # Find error handling
   grep -rn "catch\|except\|error" {relevant files}

   # Find state mutations
   grep -rn "setState\|set\|update\|mutate" {relevant files}

   # VMark: Zustand stale reads
   grep -rn "getState()" src/

   # VMark: Unsafe error casts
   grep -rn "as Error" src/

   # VMark: Missing listener cleanup
   grep -rn "listen\|onEvent" src/ | grep -v "unlisten\|cleanup"
   ```
4. **Report findings** in the same format

**Do NOT stop if Codex returns empty. Always complete the analysis.**
