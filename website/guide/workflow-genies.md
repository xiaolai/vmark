# Workflow Genies

A **workflow genie** is a [genie workflow](/guide/workflows) — a multi-step YAML pipeline — saved into your genies folder as a `.yml` or `.yaml` file. It shows up in the genie picker (`Mod + Y`) and in **Edit → Genies** exactly like a markdown genie; choosing it runs the whole pipeline through the workflow engine instead of sending a single prompt.

## Requirements

| Requirement | Why |
|-------------|-----|
| **Settings → Advanced → Developer tools**, then **Workflow Engine** turned on | The engine is off by default. The picker still lists a workflow genie while the engine is off, but running it fails with "The workflow engine is turned off in Settings" |
| An open workspace | Action steps such as `action/save-file` resolve paths against the workspace root; without one, VMark shows a toast and does not start the run |
| A configured [AI provider](/guide/ai-providers) | Genie steps call the active provider, the same one markdown genies use |

## Writing one

Put the YAML file anywhere under the genies folder (**Edit → Genies → Open Genies Folder**); subfolders become categories, as for markdown genies. The picker shows the file name as the genie's name and the YAML's `description` (or, failing that, its `name`) as the secondary line. A workflow genie's scope is the whole document — the run has no selection to work on — so each step supplies its own `with: { input: … }`, and the markdown genies it calls bind that to their `{{content}}` placeholder unchanged.

The bundled `triage-and-translate.yml` sample is a ready-made starting point: copy it into the folder and replace the seed text. Where it lives, the full YAML schema, expressions, approvals, per-step models and timeouts are all documented in [Genie Workflows](/guide/workflows); a workflow genie's run executes and its approval dialogs appear as usual, but it does not show the live step graph, cannot be cancelled from the Workflow panel (the panel's Run reports the engine busy while it runs), and the panel offers no Restore Files for it.

See also [AI Genies](/guide/ai-genies) for the single-prompt markdown genie format.
