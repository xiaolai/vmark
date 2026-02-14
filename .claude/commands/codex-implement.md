---
description: Send a plan to Codex MCP for full autonomous implementation — choose model, effort, and sandbox level
argument-hint: "<plan-file-or-inline-plan>"
---

# Codex Implement

Delegate an entire implementation plan to Codex MCP. Claude is the architect, Codex is the builder.

## Input

```text
$ARGUMENTS
```

## Workflow

### Step 1: Resolve the plan

Determine the plan content from `$ARGUMENTS`:

| Input | Action |
|-------|--------|
| A file path (e.g. `plan.md`, `./docs/plan.txt`) | Read the file to get the plan |
| Inline text | Use the text directly as the plan |
| (empty) | Look for `PLAN.md` in cwd, then ask the user |

Read the plan content and display a brief summary to the user.

### Step 2: Let user choose model and settings

Follow the instructions in `commands/_model-selection.md` to discover available models and present choices.

- **Recommended model**: `gpt-5.3-codex`
- **Recommended reasoning effort**: `medium`
- **Recommended sandbox level**: `workspace-write`
- **Include sandbox question**: Yes

### Step 3: Confirm and send to Codex

Show the final configuration:
- Plan: (summary)
- Working directory: {cwd}
- Model: {chosen_model}
- Reasoning effort: {chosen_effort}
- Sandbox: {chosen_sandbox}

Then call `mcp__codex__codex` with:

```
mcp__codex__codex with:
  prompt: "Execute the following plan completely from start to finish in the current working directory.

IMPORTANT RULES:
- Implement EVERY step in the plan. Do not skip anything.
- Create all files, install all dependencies, write all code as specified.
- Run tests/builds if the plan includes them.
- If a step fails, debug and fix it before moving on.
- After completing all steps, run a final verification (build, test, lint — whatever applies).
- Report a summary of: files created, files modified, commands run, and any issues encountered.

THE PLAN:
{plan_content}"
  model: {chosen_model}
  config: {"model_reasoning_effort": "{chosen_effort}"}
  sandbox: {chosen_sandbox}
  approval-policy: never
  developer-instructions: "You are an autonomous implementation agent. Execute plans completely."
```

**IMPORTANT**: Wait for Codex to fully complete before proceeding. Do NOT run multiple Codex calls in parallel.

### Step 4: Verify results

After Codex finishes:

1. Run `git status` to see all changes Codex made
2. Run `git diff --stat` to summarize the scope
3. If the project has tests, run them to verify correctness
4. Report the results to the user:

```markdown
## Codex Implementation Complete

**Model**: {chosen_model} | **Effort**: {chosen_effort} | **Sandbox**: {chosen_sandbox}
**Thread ID**: `{threadId}` _(use `/codex-continue {threadId}` to iterate)_

**Files created**: {list}
**Files modified**: {list}
**Commands run**: {list}

### Verification
- Tests: PASS / FAIL / N/A
- Build: PASS / FAIL / N/A

### Issues
- {any issues or warnings}
```

### Step 5: Offer next steps

Ask the user what to do next:
- Review the changes in detail
- Commit the changes
- Run additional tests
- Revert if something went wrong (`git checkout .`)
