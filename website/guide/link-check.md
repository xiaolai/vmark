# Link Check

VMark verifies that local link and image targets in your markdown actually exist on disk. Runs alongside the [markdown lint engine](/guide/lint) on `Cmd-Shift-L` or **Tools → Check Markdown**.

## What it checks

For every local link and image in the document:

- `[text](./other.md)` — the file `./other.md` resolves and exists
- `![alt](./image.png)` — the image file exists
- `[text](./other.md#section)` — the file exists (anchor checking is handled by the [`linkFragments` rule](/guide/lint#rule-reference))

When a target is missing, the link's text is underlined with a red squiggle and an entry appears in the lint badge / F2 navigation.

## What it skips

- **Fragment-only links** (`#anchor`) — handled by the `linkFragments` rule which checks against the current document's headings
- **External URLs** — `http://`, `https://`, `ftp://`, `mailto:`, `tel:`, `data:`, `file:`
- **Untitled documents** — without a saved file path, relative URLs can't be resolved against any directory

## How resolution works

Link Check resolves paths relative to the source file's directory:

| Link in `/repo/docs/intro.md` | Resolves to |
|---|---|
| `[a](./other.md)` | `/repo/docs/other.md` |
| `[a](../shared.md)` | `/repo/shared.md` |
| `[a](images/logo.png)` | `/repo/docs/images/logo.png` |
| `[a](/docs/intro.md)` | `/repo/docs/docs/intro.md` (rooted as relative within the file's dir) |

Fragments are stripped before file lookup — `[a](./other.md#section)` checks `./other.md` only.

## Performance

- **Async** — runs in parallel with the sync rules; results merge in when ready
- **Deduped** — each unique resolved path is checked once per run, even if linked multiple times
- **No keystroke triggering** — fs.exists on every keystroke would thrash; runs only on the explicit lint trigger
- **Operational error tolerance** — if `fs.exists` throws (permission denied, capability scope issue), the result is `error` (skipped), not `missing`. Better silent than wrong.

## Diagnostic codes

| Code | Severity | Trigger |
|---|---|---|
| **M001** | Error | Image file not found at resolved local path |
| **M002** | Error | Linked file not found at resolved local path |

## See also

- [Markdown Lint](/guide/lint) — full rule reference
- [Settings → Markdown → Lint](/guide/settings#lint)
