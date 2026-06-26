# Knowledge Base & Slidev

VMark can serve your whole workspace as a browsable, cross-linked knowledge
base, and preview/export [Slidev](https://sli.dev) presentation decks — both
powered by a single local content server that VMark starts on demand.

::: warning Status
This feature is rolling out in phases. The content server (knowledge-base
rendering, relationship graph, search, live reload) and Slidev preview run on a
bundled Node runtime. Slidev export additionally provisions a headless Chromium
on first use. See the in-app **Knowledge Base** panel.
:::

## Opening the panel

Open the **Knowledge Base** panel from **View → Knowledge Base**, the command
palette ("Toggle Knowledge Base"), or the `Ctrl + Shift + 4` shortcut. The panel
docks on the right; toggle it again to hide it.

## Knowledge base

Open a workspace and start the **Knowledge Base** panel. VMark launches a local
server bound to `127.0.0.1` (loopback only) and renders every markdown file as
HTML using the same markdown semantics as the editor — wiki-links, alerts,
math, tables, task lists, and details all render identically.

Capabilities:

- **Wiki-link navigation** — `[[Page]]`, `[[dir/Page]]`, `[[Page#Heading]]`, and
  `[[Page|Alias]]` resolve across the workspace. Unresolved links render as
  "missing" so gaps are visible.
- **Relationship graph** — notes, tags (`#tag` and frontmatter `tags:`), and
  typed frontmatter relations (`up`, `related`, `links`, …) form an interactive
  graph with backlinks.
- **Full-text search** across the workspace.
- **Live reload** — saved edits refresh the served pages automatically.

You can view the knowledge base inside VMark (embedded panel) or **open it in
your browser** — the "Open in browser" action performs a one-time authenticated
handshake so your browser receives a session cookie. The server is loopback-only
and cookie-gated; it never exposes your workspace beyond your machine, and only
trusted workspaces are served.

## Slidev presentations

When you open a markdown file whose frontmatter marks it as a Slidev deck (e.g.
`theme:`, `layout:` + slides, or an explicit `format: slidev`), VMark can run
the real Slidev toolchain to preview it live — the same renderer Slidev uses, so
layouts, click animations, and components are fully faithful.

With the deck open and the Knowledge Base panel running, use **Preview slides**
to open the live deck in your browser and **Export slides** to render it. Slidev
watches the deck on disk, so saving edits in VMark hot-reloads the open preview.

### Export

Slidev decks export to **PDF**, **PNG**, or **PPTX**. The first export
downloads a headless Chromium (used only for rendering slides); subsequent
exports reuse it. If a system Chrome/Edge is preferred, VMark can point the
exporter at it instead.

## Privacy & security

- The server binds `127.0.0.1` only and requires a per-session token (delivered
  as an HttpOnly, SameSite=Strict cookie).
- File access is contained to the workspace root; path traversal is rejected and
  symlinks are not followed.
- Rendered HTML is sanitized; remote resources follow a content-security policy
  that tightens for untrusted workspaces.
