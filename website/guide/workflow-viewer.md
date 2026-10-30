# GitHub Actions Workflow Viewer

VMark renders GitHub Actions workflow YAML as an interactive directed-acyclic-graph (DAG) and lets you edit jobs, steps, triggers, permissions and concurrency through structured forms — without ever losing comments, anchors, or formatting in the underlying file.

The feature works in two surfaces:

1. **Standalone `.yml` files** under `.github/workflows/` (or any YAML file with top-level `on:` and `jobs:` keys): split view with the source on the left and the interactive canvas + forms editor on the right.
2. **Markdown code fences**: when a triple-backtick `yaml` or `yml` fenced block contains a recognizable workflow, VMark renders it inline as a picture of the same job graph, the way `mermaid` blocks are rendered.

::: tip Not the same as VMark's own workflows
A YAML file whose top-level `steps:` use `genie/…` or `action/…` is a [Genie Workflow](/guide/workflows) — VMark's own pipeline format, which VMark can run. A GitHub Actions workflow is only viewed and edited here; see [What this is not](#what-this-is-not).
:::

## Standalone workflow files

Open any `.github/workflows/*.yml` file in VMark. The file opens in a split view — YAML source on the left, the workflow workbench on the right (the Source / Split / Preview toggle switches layouts). The workbench shows:

- The full workflow as an interactive React Flow canvas (jobs as nodes, `needs:` dependencies as edges). Its control strip zooms, fits the graph to the pane, and switches the layout between top-to-bottom and left-to-right — handy for a long `needs:` chain in a wide pane.
- The export control in the canvas's top-right corner (see [Exports](#exports)).
- A structured editor panel below the canvas: the [Diagnostics](#diagnostics) banner, the Save / Discard controls, the workflow-level forms, and the form for whatever job or step is selected.

Click a job in the canvas to edit it. Click a step inside the job to edit that step. Escape clears the selection and returns focus to the source.

While you edit the source, VMark keeps the two panes in sync: moving the cursor into a job's lines highlights its node on the canvas, `${{ }}` expressions autocomplete against the parsed workflow's contexts, and Cmd-clicking a local `uses:` reference opens the target file.

### Job editing

Editable fields:

| Field | Patch kind |
|-------|------------|
| `name` | `job.set` |
| `runs-on` | `job.set` |
| `if` | `job.set` |

Read-only summary: step count, `needs:`, and `uses:` (for reusable-workflow jobs).

**Add job** (above the forms) creates a job from an ID you type — it must start with a letter or underscore and not already exist — running on `ubuntu-latest` until you change it. The job form's delete button removes the selected job after you confirm.

The job form also lists the job's steps. Each row can be moved up or down or deleted (after a confirmation), and **Add step** appends a new step as `run: echo TODO`, ready to edit.

### Step editing

Editable fields:

| Field | Patch kind |
|-------|------------|
| `name` | `step.set` |
| `run` (for run-steps) | `step.set` |
| `working-directory` | `step.set` |
| `if` | `step.set` |
| `with:` keys | `with.set` / `with.remove` |

The `with:` block renders as add/edit/remove key/value rows. Renaming a key emits a `with.remove` for the old key followed by a `with.set` for the new one. A key already used by another row is refused inline.

For `uses:` steps, the action reference itself is read-only — change it in source if you need a different action.

In the step form, **Alt + Left** / **Alt + Right** move to the previous / next step. The shortcut works anywhere in the window, except inside a text field, select or code editor, where Alt + Arrow keeps its normal word-navigation meaning.

### Triggers

A trigger written as a mapping (`on: { push: { branches: [main] } }`) has editable filter fields — branches, branches-ignore, tags, tags-ignore, paths, paths-ignore and types — each a comma-separated list. A `schedule` cron is shown as a sentence in the UI language — day and month names stay as English three-letter abbreviations (`Mon`, `Jan`) — with a warning when it runs more often than every 5 minutes (GitHub throttles those), and is read-only. So is a trigger written as a bare event name or a list of names; edit those in source.

### Permissions and concurrency

Two workflow-level forms sit above the job form:

- **Permissions** — GitHub's default (no `permissions:` key), `read-all`, `write-all`, `none`, or a per-scope table (`contents`, `pull-requests`, …) with read / write / none for each.
- **Concurrency** — the `group` and whether to `cancel-in-progress`. A `cancel-in-progress` written as an expression is shown but not editable here.

## Saving edits

Edits queue up in an in-memory patch list as you change fields. The Save button shows the current count (e.g., **3 unsaved**), and new jobs and steps already appear in the canvas and forms before you save.

When you click Save, VMark:

1. Reads the current YAML from the editor.
2. Applies every queued patch to the YAML's CST (concrete syntax tree) — preserving comments, anchors, and existing formatting.
3. For a file on disk, writes the result to the file, then updates the editor to match — unless you typed in the source meanwhile, in which case your typing is kept.

If the write fails, nothing is lost: the edits stay queued and you can save again. An untitled document has no file to write, so Save updates the editor only; press **Cmd+Shift+S** to save it. **Discard** drops the queued edits.

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
```
````

VMark detects the workflow shape (top-level `on:` and `jobs:` keys) and renders a picture of its job graph inline — the same canvas as the standalone view, captured as an image. The picture is read-only; double-click it to edit the source.

## Diagnostics

VMark surfaces parse + lint diagnostics in a banner at the top of the forms panel. Clicking a row jumps the source to the offending line, or selects the offending job when the line is not available (for example in Preview mode):

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

Install `actionlint` for richer expression diagnostics. With **Use actionlint when available** on — in Settings → Advanced (Workflow files), on by default — VMark runs the binary from your login-shell PATH each time a workflow file's source changes and appends its findings to the workbench's Diagnostics banner, tagged `GHA-ACTIONLINT-<rule>`; the built-in checks above never wait for it. If the toggle is on but the binary is not installed, VMark tells you once per session and otherwise stays quiet; if the binary is present but fails to run, the failure is reported once with actionlint's own message. Turn the toggle off to skip actionlint entirely. The MCP `workflow.validate` operation runs the same check on demand.

## Action metadata

For `uses:` steps that reference public GitHub Actions, VMark fetches each action's `action.yml` to populate input descriptions in the structured editor. Results are cached on disk for 24 hours. Workspace-local actions (`./…`) are read from disk, never the network.

To keep the workflow editor fully offline, turn off **Fetch action metadata** in Settings → Advanced (Workflow files) — with it off, no network requests are made and the `with:` form falls back to free-form key/value rows.

## Exports

The export control in the top-right corner of the canvas offers three formats:

| Format | Use for |
|--------|---------|
| **Mermaid** | Embedding in READMEs and other markdown docs. Copied to the clipboard. Lossy: omits run status, action icons, custom badges, and matrix expansion details. |
| **SVG** | Embedding in docs that need vector graphics. Uses `foreignObject` for HTML content. |
| **PNG** | Sharing in chat or anywhere SVG isn't supported. Renders at the canvas's current zoom. |

## What this is not

VMark does not execute GitHub Actions workflows. It is a viewer and editor — execution remains GitHub's job. The feature is purely for reading, reviewing, and authoring workflow YAML. VMark's own runnable pipelines are a different format: see [Genie Workflows](/guide/workflows).
