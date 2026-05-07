# GitHub Actions Workflow Viewer

VMark renders GitHub Actions workflow YAML as an interactive directed-acyclic-graph (DAG) and lets you edit jobs, steps, and triggers through structured forms — without ever losing comments, anchors, or formatting in the underlying file.

The feature works in two surfaces:

1. **Standalone `.yml` files** under `.github/workflows/` (or any file whose top-level shape matches a workflow): split view with the source on the left and the interactive canvas + forms editor on the right.
2. **Markdown code fences**: when a triple-backtick `yaml` or `yml` fenced block contains a recognizable workflow, VMark renders it as a Mermaid-style DAG inline, the same way `mermaid` blocks are rendered.

## Standalone workflow files

Open any `.github/workflows/*.yml` file in VMark. The right-hand side panel opens automatically and shows:

- The full workflow as an interactive React Flow canvas (jobs as nodes, `needs:` dependencies as edges).
- A structured editor panel below the canvas.
- Save / Discard controls in the editor header.

Click a job in the canvas to edit it. Click a step inside the job to edit that step.

### Job editing

Editable fields:

| Field | Patch kind |
|-------|------------|
| `name` | `job.set` |
| `runs-on` | `job.set` |
| `if` | `job.set` |

Read-only summary: step count, `needs:`, and `uses:` (for reusable-workflow jobs).

### Step editing

Editable fields:

| Field | Patch kind |
|-------|------------|
| `name` | `step.set` |
| `run` (for run-steps) | `step.set` |
| `working-directory` | `step.set` |
| `if` | `step.set` |
| `with:` keys | `with.set` / `with.remove` |

The `with:` block renders as add/edit/remove key/value rows. Renaming a key emits a `with.remove` for the old key followed by a `with.set` for the new one.

For `uses:` steps, the action reference itself is read-only — change it in source if you need a different action.

### Triggers

The trigger summary (event, branches, tags, paths, cron, types) is read-only in this version. Editing dense trigger structure via single-line inputs is too lossy; edit triggers in source until a dedicated picker ships.

## Saving edits

Edits queue up in an in-memory patch list as you change fields. The Save button shows the current count (e.g., **3 unsaved**).

When you click Save, VMark:

1. Reads the current YAML from the editor.
2. Applies every queued patch to the YAML's CST (concrete syntax tree) — preserving comments, anchors, and existing formatting.
3. Writes the result back into the editor as if you had typed it.

The file becomes dirty in the normal sense; press **Cmd+S** to write to disk.

### Preserving formatting

The default save path runs every patch through the `yaml` package's CST API — comments, anchor nodes, custom indentation, and existing flow-vs-block style choices are preserved.

Disable **Preserve YAML formatting on save** in Settings → Advanced if you prefer canonical reformatted output. The reformat path drops comments, so this is opt-in.

## Code fences in markdown

Type a workflow into a YAML code fence:

````markdown
```yaml
name: ci
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test
```text
````

VMark detects the workflow shape (top-level `jobs:` with `runs-on` per job) and renders the diagram inline. The diagram is read-only — edit the source to change the workflow.

## Diagnostics

VMark surfaces parse + lint diagnostics next to the source:

| Code prefix | Meaning |
|-------------|---------|
| `GHA-PARSE-*` | Malformed YAML or missing required keys |
| `GHA-JOB-*` | Job-level issues (duplicate id, conflicting `uses:` + `steps:`) |
| `GHA-NEEDS-*` | Dependency issues (unknown ref, cycle) |
| `GHA-STEP-*` | Step-level issues |
| `GHA-EXPR-*` | Unknown context references |
| `GHA-MATRIX-*` | Matrix expansion issues |
| `GHA-SEC-*` | Security warnings (e.g., `pull_request_target` checkout patterns) |
| `GHA-ACTIONLINT-*` | Forwarded from `actionlint` if installed |

Install `actionlint` and turn on **Use actionlint when available** in Settings → Advanced for richer expression diagnostics.

## Action metadata

For `uses:` steps that reference public GitHub Actions, VMark can fetch each action's `action.yml` to populate input descriptions in the structured editor. This is opt-in and cached on disk for 24 hours.

Toggle **Fetch action metadata** in Settings → Advanced. Disable to keep all action references purely text — no network requests are made.

## Exports

The workflow side panel includes three export options accessible from its header menu:

| Format | Use for |
|--------|---------|
| **Mermaid** | Embedding in READMEs and other markdown docs. Lossy: omits run status, action icons, custom badges, and matrix expansion details. |
| **SVG** | Embedding in docs that need vector graphics. Uses `foreignObject` for HTML content. |
| **PNG** | Sharing in chat or anywhere SVG isn't supported. Renders at the canvas's current zoom. |

## What this is not

VMark does not execute GitHub Actions workflows. It is a viewer and editor — execution remains GitHub's job. The feature is purely for reading, reviewing, and authoring workflow YAML.
