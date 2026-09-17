# Knowledge Base & Slidev

VMark can serve your whole workspace as a browsable, cross-linked knowledge
base, and preview/export [Slidev](https://sli.dev) presentation decks — both
powered by a single local content server that VMark starts on demand.

::: warning Status
This feature is rolling out in phases, and **no release build on any platform
includes the content-server runtime** it depends on — see
[Requirements](#requirements). Because of that it is **hidden unless Developer
Mode is on**: the View menu item, the command palette entry and the
`Ctrl + Shift + 4` shortcut only appear once you enable **Settings → Advanced →
Developer tools**. Turn that on and open the **Knowledge Base** panel to see
what your machine has and what is missing.
:::

## Requirements

The knowledge base, its relationship graph, search, live reload and Slidev
preview all run on one local content server — a separate Node.js program that
VMark starts on demand. Two things must be present before it can start:

- **Node.js.** VMark resolves `node` through your login shell's `PATH`, the way
  a terminal would, so a Node.js that only a project-local tool can see does not
  count. Install it so that `node` is on your login-shell `PATH`.
- **The content server itself** (`server/content` in the VMark repository,
  built to a `cli.js`). **No packaged VMark build includes it yet — on any
  platform.** This is not a Linux or Windows gap: the macOS DMG ships no
  content-server runtime either, and VMark's release checks assert that on every
  release. Until a release story lands, the feature requires a development
  setup — a checkout of VMark with the content server built, made available
  through the `VMARK_CONTENT_SERVER_CLI` environment variable (or a provisioned
  `base-kb` runtime in VMark's application data).

The panel checks both when it opens. When either is missing it says which one,
and what would provide it, instead of attempting a start that cannot succeed.

## Opening the panel

The Knowledge Base is **hidden by default**, because a release build cannot
start it. To reveal it, turn on **Settings → Advanced → Developer tools**. The
**View → Knowledge Base** menu item, the command palette entry ("Toggle
Knowledge Base") and the `Ctrl + Shift + 4` shortcut all appear with it, and all
disappear again when you turn it off.

With Developer tools on, open the panel from **View → Knowledge Base**, the
command palette, or `Ctrl + Shift + 4`. The panel docks on the right; toggle it
again to hide it.

Turning Developer tools back off hides the entry points again, and closes the
panel with them: the panel has no close button of its own, so leaving it open
would strand a dock nothing could dismiss. A server that is already **running**
is left alone — turn Developer tools back on to reach its Stop button, and VMark
stops its content servers when it quits in any case.

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
and cookie-gated; it never exposes your workspace beyond your machine.

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
- Rendered HTML is sanitized and served under a content security policy.
  **Workspace trust changes exactly one thing here: whether remote images
  render.** VMark passes the workspace's trust to the server when it starts
  it; for a trusted workspace the policy relaxes `img-src` so `https:` images
  load, for an untrusted workspace only local and inline images render. Trust
  does not decide whether a workspace is served — any open workspace can be.
  Changing a workspace's trust while its knowledge base is running restarts
  the server, so the policy follows the change.
