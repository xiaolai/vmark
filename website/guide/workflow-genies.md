<script setup>
// Skip Vue template processing for the whole page so ${{ }} expressions
// in code spans and fenced YAML blocks don't get interpreted.
</script>

<div v-pre>

# Workflow Genies

VMark Genies come in two flavors:

- **Markdown genies** (`.md`) — single-shot prompt templates. The original Genie format. See [AI Genies](/guide/ai-genies).
- **Workflow genies** (`.yml` / `.yaml`) — multi-step pipelines that chain markdown genies together with explicit data flow.

Both formats live in the same global genies directory and surface in the same picker (`Cmd+Y`). A workflow genie shows up as a regular Genie row; selecting it spawns the workflow runner instead of the one-shot AI call.

## When to use which

| Need | Format |
|------|--------|
| Single transformation (rewrite, translate, summarize) | Markdown |
| Outline → draft → polish pipeline | Workflow |
| Different AI models for different stages | Workflow |
| Steps that need approval gates | Workflow |
| Output of one stage feeds the next | Workflow |

If a single prompt fits, use a markdown genie. If you need to compose stages, structured data flow, or human-in-the-loop approval, use a workflow.

## File format

A workflow genie is a YAML file. Top-level fields:

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | Yes | Human-readable label. The picker uses the **filename** as the display name; this field appears as the description if no `description:` is set. |
| `description` | No | One-line summary shown in the picker. |
| `defaults` | No | Default model / approval / limits applied to every step. |
| `env` | No | Environment variables available as `${VAR}` or `${{ env.NAME }}`. |
| `steps` | Yes | Ordered list of steps. |

### Step shape

```yaml
- id: my-step
  uses: genie/<name>     # or action/<name>
  with:
    input: "text or expression"
  needs: prior-step      # optional; can also be a list
  approval: ask          # optional; "auto" (default) or "ask"
  model: claude-sonnet   # optional; overrides defaults
  limits:
    timeout: 120s        # default 300s
    max_tokens: 4096     # REST providers only
```

### Step types

| `uses:` prefix | Behavior |
|----------------|----------|
| `genie/<name>` | Loads the matching markdown genie, fills its template with the step's `with:` map, calls the active AI provider. The markdown genie's `{{content}}` / `{{input}}` placeholders pick up `with.input` automatically. |
| `action/read-file` | Reads a workspace-relative path. Output is the file body. |
| `action/save-file` | Writes `with.input` to `with.path`. |
| `action/notify` | Logs `with.message`. |
| `action/copy` | Returns `with.input` unchanged (useful for chaining). |

### Expressions

Inside any `with:` value:

| Syntax | Resolves to |
|--------|-------------|
| `${{ steps.ID.outputs.FIELD }}` | A specific output field of a prior step. |
| `${{ steps.ID.output }}` | Sugar for `outputs.text` of a prior step. |
| `${{ env.NAME }}` | A workflow `env:` value. |
| `${VAR}` | Same as above, legacy form. |
| `stepId.output` (whole-string) | Legacy alias for `${{ steps.stepId.output }}`. |

Unknown step / field references fail the step at parameter-resolution time, before any AI call.

### Template binding

When a `genie/<name>` step runs, its markdown genie's prompt template is filled per these rules:

- `{{input}}` → `with.input`
- `{{content}}` → `with.content` if present, else `with.input` (fatal if neither)
- `{{context}}` → `with.context` if present, else empty string (never fatal)
- `{{any-other-key}}` → `with.<key>` (fatal if missing)

This means **existing markdown genies work unchanged** in workflows — call them with `with: { input: "..." }` and the `{{content}}` placeholder picks it up via the alias chain.

### Approval gate

When a step has `approval: ask` (or workflow `defaults.approval: ask`), the runner pauses, opens a dialog showing the resolved prompt preview and model, and waits for the user's verdict before calling the provider. Esc denies. The timeout is the smaller of the step's `limits.timeout` and 10 minutes.

## Sample

VMark ships with a sample workflow at `outline-and-polish.yml` in your bundled genies. Copy it into your user genies directory to customize:

```yaml
name: Outline and Polish
description: Generate an outline, then polish the output for clarity.

defaults:
  approval: auto

steps:
  - id: outline
    uses: genie/outline
    with:
      input: "Replace this seed with your topic."

  - id: polish
    uses: genie/polish
    needs: outline
    with:
      input: ${{ steps.outline.outputs.text }}
```

`genie/outline` produces a structured outline; the `polish` step then rewrites that output for clarity. The two `genie/*` references resolve to the bundled markdown genies in `structure/outline.md` and `editing/polish.md`.

## Cancellation, timeouts, limits

- **Cancel** — Click Stop in the workflow side panel. The runner kills any in-flight CLI provider child process within one tick and drops in-flight REST requests.
- **Per-step timeout** — Wrapped in `tokio::time::timeout(step.limits.timeout)`. On elapsed, the step fails with "Timed out after Xs" and downstream steps skip.
- **Output cap** — A single step's output is capped at 5 MB. A runaway provider triggers cancel + "Provider output exceeded 5 MB cap".

## See also

- [AI Genies](/guide/ai-genies) — markdown genie format and authoring.
- [Workflow viewer](/guide/workflow-viewer) — the same React Flow side panel used here, originally for GitHub Actions workflows.

</div>
