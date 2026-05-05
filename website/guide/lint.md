# Markdown Lint

VMark ships a built-in lint engine that catches **correctness issues**, not style preferences. Lint runs on demand (Cmd-Shift-L or **Tools → Check Markdown**) and surfaces results inline as gutter squiggles, with a status bar badge and F2 navigation between findings.

## What lint is and isn't

VMark's lint is a **correctness** checker:

- Broken cross-references
- Undefined link / footnote references
- Unclosed code fences
- Tables with mismatched column counts
- Heading levels that skip (h1 → h3)
- Images without alt text
- Empty link text or empty `href`

VMark's lint is **not** a style enforcer. It will not flag:

- Line length
- List marker style (`-` vs `*`)
- Emphasis marker style (`_` vs `*`)
- Heading style (`#` vs underline)
- Trailing whitespace

For style enforcement, use a separate tool like `prettier --check` outside VMark.

## Rule Reference

| Rule ID | Severity | Description |
|---------|----------|-------------|
| **E01** | Error | Undefined reference: `[link][missing]` points to a definition that doesn't exist |
| **E02** | Error | Table row has wrong column count (mismatch with header row) |
| **E03** | Error | Reversed link — looks like `(text)[url]` instead of `[text](url)` |
| **E04** | Error | ATX heading missing space after `#` (e.g., `##Heading` should be `## Heading`) |
| **E05** | Error | Space inside emphasis markers — `* word *` won't render as italic |
| **E06** | Error | Unclosed fenced code block — file ends with an open ```` ``` ```` fence |
| **E07** | Error | Duplicate link reference definition (same `[label]:` appears twice) |
| **E08** | Error | Empty link `href` — `[text]()` |
| **W01** | Warning | Heading level skipped (h2 expected, found h3) |
| **W02** | Warning | Image missing alt text — accessibility |
| **W03** | Warning | Unused link reference definition (defined but never linked) |
| **W04** | Warning | Anchor fragment doesn't match any heading — `#section` for a section that doesn't exist |
| **W05** | Warning | Empty link text — `[](url)` |
| **M001** | Error | Image file not found at the local path |
| **M002** | Error | Linked file not found at the local path |
| **Y001** | Error | YAML parse error (for YAML files) |
| **Y002** | Warning | YAML parse warning (for YAML files) |

## Triggering lint

| Trigger | Action |
|---|---|
| `Cmd + Shift + L` (macOS) / `Ctrl + Shift + L` (Win/Linux) | Run lint on the active document |
| **Tools → Check Markdown** | Same as the shortcut |
| `F2` | Jump to the next diagnostic |
| `Shift + F2` | Jump to the previous diagnostic |

For markdown files with file paths, link-existence checking runs automatically alongside the sync rules — see [Link Check](/guide/link-check).

For YAML files, parse errors appear live in the gutter as you type, and the same `Cmd-Shift-L` shortcut populates the badge + F2 navigation.

## Settings

The lint engine has a single user-facing toggle:

- **Settings → Markdown → Enable markdown lint** — turn the engine on or off entirely

When disabled, the shortcut becomes a no-op and no diagnostics appear in the gutter.

## See also

- [Link Check](/guide/link-check) — broken local link / image detection
- [Settings → Markdown → Lint](/guide/settings#lint)
