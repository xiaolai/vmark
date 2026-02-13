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

Present the user with choices using `AskUserQuestion`. Ask all three questions at once:

**Question 1 — Model:**

| Model | Best for |
|-------|----------|
| `gpt-5.3-codex` | Flagship — most capable, best reasoning + coding (Recommended) |
| `gpt-5.3-codex-spark` | Ultra-low-latency real-time iteration (Pro only) |
| `gpt-5.2-codex` | Previous gen — still strong, lower cost |
| `gpt-5.1-codex-max` | Long-horizon project-scale tasks |

**Question 2 — Reasoning effort:**

| Level | Best for |
|-------|----------|
| `high` | Complex architecture, multi-file refactors, tricky logic |
| `medium` | Standard feature implementation (Recommended) |
| `low` | Simple/mechanical tasks, boilerplate, formatting |

**Question 3 — Sandbox level:**

| Level | Permissions |
|-------|-------------|
| `danger-full-access` | Full read/write/execute everywhere (Recommended for implementation) |
| `workspace-write` | Write only within the working directory |
| `read-only` | Read-only, no file changes (dry run) |

### VMark Project Conventions

Append these rules to the plan prompt so Codex follows VMark conventions:

- **Tech stack**: Tauri v2 + React 19 + Zustand v5 + Vite v7
- **Project layout**: `src/` (frontend React), `src-tauri/src/` (backend Rust)
- **Zustand**: No store destructuring in components; use selectors or `getState()` in callbacks
- **CSS tokens**: No hardcoded colors — must use design tokens (see `.claude/rules/31-design-tokens.md`)
- **Cross-platform**: Every `Command::new()` must work on macOS, Windows, and Linux (see `.claude/rules/50-codebase-conventions.md`)
- **File size**: Code files should stay under ~300 lines; split if larger
- **Plugin structure**: Plugin styles must live in the plugin directory only, not in global CSS
- **Import convention**: Use `@/` alias, no `../../../` chains
- **Error handling**: Never use `error as Error` casts; handle errors properly

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
  prompt: "You are an autonomous implementation agent. Execute the following plan completely from start to finish in the current working directory.

IMPORTANT RULES:
- Implement EVERY step in the plan. Do not skip anything.
- Create all files, install all dependencies, write all code as specified.
- Run tests/builds if the plan includes them.
- If a step fails, debug and fix it before moving on.
- After completing all steps, run a final verification (build, test, lint — whatever applies).
- Report a summary of: files created, files modified, commands run, and any issues encountered.

VMARK PROJECT CONVENTIONS (follow these strictly):
- Tech stack: Tauri v2 + React 19 + Zustand v5 + Vite v7
- Project layout: src/ (frontend React), src-tauri/src/ (backend Rust)
- Zustand: No store destructuring in components; use selectors or getState() in callbacks
- CSS: No hardcoded colors — use design tokens only
- Cross-platform: Every Command::new() must work on macOS, Windows, and Linux
- File size: Keep code files under ~300 lines; split if larger
- Plugin structure: Plugin styles in plugin directory only, not global CSS
- Imports: Use @/ alias, no ../../../ chains
- Error handling: Never use 'error as Error' casts

THE PLAN:
{plan_content}"
  model: {chosen_model}
  model_reasoning_effort: {chosen_effort}
  sandbox: {chosen_sandbox}
  approval-policy: never
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
