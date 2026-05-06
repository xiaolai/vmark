# Supported Formats

VMark opens every file format below directly. The differentiator is **schema-aware previews**: when the file is a known artifact, VMark renders the *right* view, not a generic JSON tree.

[[toc]]

## At a glance

| Family | Extensions | Editor | Preview |
|---|---|---|---|
| Markdown | `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx` | WYSIWYG + Source modes | rendered prose |
| Plain text | `.txt` | source | — |
| Data | `.json`, `.jsonl` | source + tree | navigable JSON tree, schema-aware (see below) |
| Data | `.yaml`, `.yml` | source + tree | navigable tree, schema-aware (GitHub Actions) |
| Data | `.toml` | source + tree | navigable tree, schema-aware (Cargo, pyproject) |
| Diagrams | `.mmd` | source + render | live Mermaid diagram |
| Vector | `.svg` | source + render | sanitized inline render |
| Web | `.html`, `.htm` | source + render | sandboxed iframe (empty `sandbox=""`, DOMPurify, CSP) |
| Code (read-only) | `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua` | viewer (toggle to edit) | — |

Code files default to read-only with a banner offering **Enable editing** or **Open in external editor** (your `$EDITOR`).

## Schema-aware previews

When the path or content matches a known schema, VMark substitutes the right view for the generic tree.

### GitHub Actions workflow (`.github/workflows/*.yml`)

Opens with the workflow visualization (job DAG, triggers, permissions).

- Path detection: any `.yml` / `.yaml` under `.github/workflows/` routes to the workflow renderer — even with malformed YAML, so you see the degraded view with diagnostics rather than a blank tree.
- Content detection: top-level `on:` and `jobs:` keys.

### `Cargo.toml`

Opens with a Rust dependency tree — runtime, dev, and build dependencies, with version specs and feature flags.

- Path detection: filename `Cargo.toml` (case-insensitive) on POSIX or Windows paths.
- Content detection: `[package]` or `[workspace]` header.
- No network calls — VMark never resolves crates.io.

### `package.json`

Opens with an npm dependency tree — `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`.

- Path detection: filename `package.json`.
- Content detection: top-level `name` plus any of `dependencies` / `devDependencies` / `peerDependencies`.

### `pyproject.toml`

Opens with a Python dependency tree — both PEP 621 (`[project]` + `[project.optional-dependencies]`) and Poetry (`[tool.poetry.dependencies]`, `[tool.poetry.dev-dependencies]`, `[tool.poetry.group.<name>.dependencies]`).

- Path detection: filename `pyproject.toml`.
- Content detection: `[project]` or `[tool.poetry]` header (gated on a clean TOML parse).

## Editing rules

- **Markdown** ships the full toolbar, paragraph formatting, CJK rules, math, mermaid, footnotes — every existing markdown feature.
- **Data formats** (JSON, YAML, TOML) ship in the source pane with parse-error gutter markers; the tree preview updates as you type. The toolbar is hidden — markdown-only actions don't apply.
- **Visual formats** (Mermaid, SVG, HTML) ship in the source pane with the rendered view in the right pane (debounced).
- **Code formats** open as syntax-highlighted viewers; toggle to edit in place or open in your `$EDITOR`.

## Find, save, content search

- **Cmd+O** filters: "All Supported" (every registered format) and "Markdown" (legacy preset).
- **Drag-drop** accepts any registered extension.
- **Save As** filters and the default extension on save are derived from the active tab's format adapter.
- **Cmd+Shift+F** content search indexes every text-like format (markdown, txt, json, yaml, toml, html, svg, mermaid). Code files are excluded by default — they're code-viewer mode.

## Security model for HTML

Per ADR-4 in the multi-format plan, HTML preview rests on three independent layers of defense:

1. **`<iframe sandbox="">`** with an empty allow-list — no scripts, no same-origin, no forms, no popups. Sandboxing is enforced by the iframe attribute alone (CSP via `<meta>` is not a sandbox per MDN).
2. **DOMPurify sanitization** runs first — strips `<script>`, `javascript:` URLs, inline event handlers, base-href tricks.
3. **CSP `<meta>` injection** — `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none';` — restricts in-iframe resource loading.

The validator surfaces script tags, `javascript:` URLs, and inline event handlers as warnings so you can see what's being blocked.

## Open in external editor

For code files (or any tab), the read-only banner's **Open in external editor** button launches your editor of choice. Resolution order:

1. `$VMARK_EXTERNAL_EDITOR` (project-level override)
2. `$VISUAL`
3. `$EDITOR`
4. Platform default (`open -t` on macOS, `notepad.exe` on Windows, `xdg-open` on Linux)

VMark routes through a login-shell PATH so VS Code / Cursor / JetBrains wrappers resolve correctly when launched from a macOS GUI app.

## What's not supported

Per the plan's non-goals:

- **Not a code editor.** No LSP, no autocomplete, no refactoring, no debugger, no git gutters.
- **Not "every plain-text format."** Bounded scope — see the table above.
- **No HTML script execution.** Sandboxed render only.
- **No print / export / copy-as-HTML for non-markdown formats** in v1.

If a format you want isn't listed and isn't deliberately out of scope, file an issue.
