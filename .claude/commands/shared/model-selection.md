---
user-invocable: false
---
<!-- Shared partial: dynamic model selection via codex-preflight -->
<!-- Referenced by all codex-* commands. Do not use as a standalone command. -->

## Model & Settings Selection

Before starting, discover which Codex models are currently available and check for project-specific configuration.

### Step 0: Load project config (if exists)

Check if `.codex-toolkit-for-claude.md` exists in the current working directory. If it does, read it and extract:

- **Default model** — use as the recommended model (overrides the calling command's recommendation)
- **Default effort** — use as the recommended effort level
- **Default sandbox** — use as the recommended sandbox level
- **Default audit type** — used by audit commands to skip the mini/full question
- **Audit focus** — additional developer-instructions to append
- **Skip patterns** — file patterns to exclude from audits
- **Project-specific instructions** — appended to developer-instructions for all commands

If `.codex-toolkit-for-claude.md` does not exist, use the calling command's built-in defaults. Do NOT ask the user to run `/codex-init` — it's optional.

**Priority order** (highest wins):
1. User's explicit choice (from AskUserQuestion)
2. Project config (`.codex-toolkit-for-claude.md`)
3. Command's built-in defaults

### Step A: Run preflight discovery

Run the preflight script to probe available models:

```bash
bash .claude/scripts/codex-preflight.sh
```

Parse the JSON output. The structure is:

```json
{
  "status": "ok",
  "codex_version": "0.101.0",
  "auth_mode": "chatgpt_login",
  "codex_cloud": false,
  "models": ["gpt-5.3-codex", "gpt-5.2-codex", ...],
  "unavailable": ["gpt-5-codex-mini", ...],
  "reasoning_efforts": ["low", "medium", "high"],
  "sandbox_levels": ["read-only", "workspace-write", "danger-full-access"]
}
```

### Step B: Handle errors

- If `status` is `"error"` → display the `error` message to the user and **STOP**. Common fixes:
  - `"codex CLI not found"` → tell user to run `npm install -g @openai/codex`
  - `"Not authenticated"` → tell user to run `codex login`
- If `models` is an empty array → tell user "No Codex models are currently available. Check your account/subscription and try `codex login`." and **STOP**.

### Step C: Present choices via AskUserQuestion

Build the `AskUserQuestion` options **dynamically** from the preflight results. Ask all questions at once:

**Question 1 — Model** (from `models` array):

Build the option list from the available models. Use these descriptions when known:

| Model | Description |
|-------|-------------|
| `gpt-5.3-codex` | Flagship — most capable, best reasoning + coding |
| `gpt-5.3-codex-spark` | Ultra-low-latency real-time iteration (Pro only) |
| `gpt-5.2-codex` | Previous gen — good balance of speed and cost |
| `gpt-5.1-codex-max` | Long-horizon, large codebases |
| `gpt-5-codex-mini` | Fastest, cheapest |
| `o4-mini` | Fast reasoning model |
| `o3` | Strong reasoning model |
| `codex-mini-latest` | Latest mini variant |
| `gpt-4.1` | GPT-4.1 |
| `gpt-4.1-mini` | GPT-4.1 Mini — lightweight |

For any model not in this table, use the model name as the description.

**Determining the recommended model**:
1. If project config specifies a default model AND it's in the available list → use that
2. Otherwise, use the calling command's recommended model (if available)
3. If neither is available, mark the first available model as recommended

**Question 2 — Reasoning effort:**

| Level | Best for |
|-------|----------|
| `low` | Simple/mechanical tasks, quick checks |
| `medium` | Standard tasks — balanced speed and depth |
| `high` | Complex tasks — thorough, catches subtle issues |

Mark the project config's default effort as "(Recommended)" if set, otherwise use the calling command's recommendation.

**Question 3 — Sandbox level** (only if the calling command uses sandbox):

| Level | Permissions |
|-------|-------------|
| `read-only` | Read-only, no file changes (dry run) |
| `workspace-write` | Write only within the working directory |
| `danger-full-access` | Full read/write/execute everywhere |

Mark the project config's default sandbox as "(Recommended)" if set, otherwise use the calling command's recommendation.

### Step D: Apply project config to Codex calls

After the user makes their choices, when building the `mcp__codex__codex` call:

1. **developer-instructions**: Start with the command's role persona, then append:
   - The project config's "Audit Focus" additional instructions (if any)
   - The project config's "Project-Specific Instructions" (if any)

2. **Skip patterns**: Before sending files to Codex, filter out any files matching the skip patterns from the project config.

Example combined developer-instructions:
```
"You are a thorough security and code quality auditor. Prioritize security findings. Flag any auth bypass, injection, data exposure, or cryptographic weakness as Critical. This is a TypeScript project using React. Follow existing patterns in src/components/."
```
