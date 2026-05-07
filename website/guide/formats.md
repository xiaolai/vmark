# Supported Formats

VMark opens every file format below directly. The differentiator is **schema-aware previews**: when the file is a known artifact, VMark renders the *right* view, not a generic JSON tree.

[[toc]]

## Enabling formats

Markdown, plain text, and YAML/YML always open in their full editors — those are the calm defaults. Every other format below is **off by default** and gated behind a category toggle in **Settings → Formats**:

| Toggle | Enables |
|---|---|
| **Data formats** | `.json`, `.jsonl`, `.toml` (split-pane source + tree, with Cargo / package.json / pyproject schema renderers) |
| **Diagrams & SVG** | `.mmd`, `.svg` (split-pane source + sanitized live render) |
| **HTML preview** | `.html`, `.htm` (sandboxed iframe — see [Security model for HTML](#security-model-for-html)) |
| **Code viewers** | 12 read-only code viewers (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua`) |

When a category is off, the matching extensions fall through to the plain-text fallback so the file still opens — just without the preview / schema view. Flip a toggle and the registry rebuilds in place; open tabs remount with the proper adapter.

On the first launch after upgrading to multi-format support, VMark surfaces a one-time toast nudging you to **Settings → Formats**. If you dismissed it (or installed fresh), the panel is at **Settings → Formats** any time.

## At a glance

| Family | Extensions | Default | Editor | Preview |
|---|---|---|---|---|
| Markdown | `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx` | always on | WYSIWYG + Source modes | rendered prose |
| Plain text | `.txt` | always on | source | — |
| Data — YAML | `.yaml`, `.yml` | always on | source + tree | navigable tree, schema-aware (GitHub Actions) |
| Data — JSON | `.json`, `.jsonl` | requires **Data formats** toggle | source + tree | navigable JSON tree, schema-aware (`package.json`) |
| Data — TOML | `.toml` | requires **Data formats** toggle | source + tree | navigable tree, schema-aware (`Cargo.toml`, `pyproject.toml`) |
| Diagrams | `.mmd` | requires **Diagrams & SVG** toggle | source + render | live Mermaid diagram |
| Vector | `.svg` | requires **Diagrams & SVG** toggle | source + render | sanitized inline render |
| Web | `.html`, `.htm` | requires **HTML preview** toggle | source + render | sandboxed iframe (empty `sandbox=""`, DOMPurify, CSP) |
| Code (read-only) | `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua` | requires **Code viewers** toggle | viewer (toggle to edit) | — |

Code files default to read-only with a banner offering **Enable editing** or **Open in external editor**.

## Schema-aware previews

When the path or content matches a known schema, VMark substitutes the right view for the generic tree.

### GitHub Actions workflow (`.github/workflows/*.yml`)

Opens with the workflow visualization (job DAG, triggers, permissions).

- Path detection: a `.yml` / `.yaml` file under `.github/workflows/` routes to the workflow renderer — even with malformed YAML, so you see the degraded view with diagnostics rather than a blank tree. (The file must reach the YAML adapter first; that requires the `.yml`/`.yaml` extension.)
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
- **Data formats** (JSON, YAML, TOML) ship in the source pane with parse-error gutter markers; the tree preview updates as you type. Markdown-only menu actions are disabled (CJK formatting, insert-block, paragraph formatting); mode-relevant controls remain active.
- **Visual formats** (Mermaid, SVG, HTML) ship in the source pane with the rendered view in the right pane (debounced).
- **Code formats** open as syntax-highlighted viewers; toggle to edit in place or open in your external editor (see below).

## Find, save, content search

- **Cmd+O** filters: a single "All Supported" preset covering every registered format. Save-As filters and the default save extension are derived from the active tab's format adapter, so saving a `.toml` file proposes `.toml` as the extension.
- **Drag-drop** accepts any registered extension.
- **Save As** filters and the default extension on save are derived from the active tab's format adapter.
- **Cmd+Shift+H** content search ("Find in Files") indexes every text-like format (markdown, txt, json, yaml, toml, html, svg, mermaid). Code files are excluded by default — they're code-viewer mode.

## Security model for HTML

Per ADR-4 in the multi-format plan, HTML preview rests on three independent layers of defense:

1. **`<iframe sandbox="">`** with an empty allow-list — no scripts, no same-origin, no forms, no popups. Sandboxing is enforced by the iframe attribute alone (CSP via `<meta>` is not a sandbox per MDN).
2. **DOMPurify sanitization** runs first — strips `<script>`, `javascript:` URLs, inline event handlers, base-href tricks.
3. **CSP `<meta>` injection** — `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none';` — restricts in-iframe resource loading.

The validator surfaces script tags, `javascript:` URLs, and inline event handlers as warnings so you can see what's being blocked.

## Open in external editor

For code files, the read-only banner's **Open in external editor** button launches your editor of choice. Resolution order:

1. **Settings → Formats → External editor** (the GUI field — see [Settings](/guide/settings#formats)). Pick an `.app` bundle on macOS, an executable on Linux/Windows, or anything your shell would resolve.
2. `$VMARK_EXTERNAL_EDITOR` (project-level env override)
3. `$VISUAL`
4. `$EDITOR`
5. Platform default (`open -t` on macOS, `notepad.exe` on Windows, `xdg-open` on Linux)

The GUI setting wins over the environment variables — explicit beats implicit. Leave the field empty to use the env-var fallback chain.

VMark routes through a login-shell PATH so VS Code / Cursor / JetBrains wrappers resolve correctly when launched from a macOS GUI app.

### Security gate

The `open_in_external_editor` Tauri command rejects:

- non-existent paths
- directories and other non-regular files (sockets, devices)
- paths whose canonicalized extension is not in VMark's registered format set
- symlinks whose canonical target fails any of the checks above

A compromised webview cannot use the button to launch the external editor on arbitrary system files (passwords, keys, etc.) — only on paths VMark would itself open.

## What's not supported

Per the plan's non-goals:

- **Not a code editor.** No LSP, no autocomplete, no refactoring, no debugger, no git gutters.
- **Not "every plain-text format."** Bounded scope — see the table above.
- **No HTML script execution.** Sandboxed render only.
- **No print / export / copy-as-HTML for non-markdown formats** in v1.
- **Not yet supported as code viewers**: Zig, Swift, Kotlin, Java, Elixir, OCaml, and other languages outside the 12-extension set. The decision rule is "languages we ourselves use" — file an issue if you'd like one added.

If a format you want isn't listed and isn't deliberately out of scope, file an issue.
