---
description: Check Codex connectivity, authentication, and discover available models
---

# Codex Preflight Check

Run a preflight check to verify Codex is working and discover which models are available.

## Workflow

### Step 1: Run the preflight script

```bash
bash .claude/scripts/codex-preflight.sh
```

Parse the JSON output from stdout. The script also prints a human-readable summary to stderr.

### Step 2: Display results

Present the results in a clear, readable format:

```markdown
## Codex Preflight Results

**Status**: {status}
**Codex version**: {codex_version}
**Auth mode**: {auth_mode}
**Codex Cloud**: {codex_cloud}

### Available Models

| Model | Status |
|-------|--------|
| {model} | Available |
| ... | ... |

### Unavailable Models

| Model | Status |
|-------|--------|
| {model} | Unavailable |
| ... | ... |

### Options

- **Reasoning efforts**: low, medium, high
- **Sandbox levels**: read-only, workspace-write, danger-full-access
```

### Step 3: Handle errors

- If `status` is `"error"`:
  - Display the error message prominently
  - Suggest fixes:
    - `"codex CLI not found"` → `npm install -g @openai/codex`
    - `"Not authenticated"` → `codex login`
- If `models` is empty:
  - Warn: "No models are currently available"
  - Suggest: Check subscription status, try `codex login`

### Step 4: Summary

End with a one-line verdict:

- All good: "Codex is ready. {N} models available."
- Partial: "Codex is reachable but only {N} of {total} models are available."
- Error: "Codex is not ready. See errors above."
