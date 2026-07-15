# Embedded Browser

VMark can host a real web browser **inside** a document window — a web page becomes a first-class tab alongside your markdown documents. It is a genuine native webview (macOS `WKWebView`), not an external Chrome window and not an embedded frame.

::: warning Experimental
The embedded browser is an early, opt-in feature and is **macOS-only** in this build. Windows and Linux support comes later.
:::

## Enabling it

The browser is off by default. To turn it on:

1. Open **Settings → Advanced**.
2. Enable **Developer mode** (the switch at the top of the Advanced section).
3. Under **Experimental**, turn on **Embedded browser**.

Once enabled, **New Browser Tab** appears in the command palette (open it with your command-palette shortcut and type "browser").

Once enabled, **New Browser Tab** appears in the **File** menu (`Alt + Mod + Shift + B`) and in the command palette.

## Using it

A browser tab opens in the editor area, alongside your documents — the sidebar, tab strip, terminal, and status bar all stay where they are. Its controls live in the **bottom bar**, in the same place VMark keeps the editor's own tools:

| Control | Action |
|---------|--------|
| ‹ / › | Back / forward. Greyed out when there is nowhere to go |
| ⟳ / ✕ | Reload, or stop a load in progress |
| Address bar | An **omnibox**: type a URL to go there, or anything else to search |
| ☆ / ★ | Bookmark this page |

The address bar tracks the page automatically: if a site redirects, or a link takes you elsewhere, the bar updates to show where you actually are.

## The sidebar follows the tab

When a browser tab is active, the sidebar shows **browsing history** and **bookmarks**. When you switch back to a document, it shows the file explorer, outline, and file history again — automatically. There is no second mode to keep in sync, and each side remembers what you last had open, so a glance at a browser tab does not cost you the file tree you were using.

**History** is per-window and lives only for the session: it is never written to disk. (There is still a **Clear** button — "it goes away when you quit" is not the same as "you can get rid of it now.") A reload does not add a duplicate entry, and a site that redirects you records the page you *meant* to visit rather than every hop along the way.

**Bookmarks** do persist. They are stored under the exact URL you bookmarked — same page, different section (`#install` vs `#usage`) are two bookmarks, and VMark will not quietly "tidy" a URL's query parameters, because a rewritten URL may not take you back to what you saw.

### If a page crashes

If a page's web content process dies, the tab shows a **"This page crashed"** overlay with a **Reload** button instead of a blank or frozen view. VMark auto-reloads a few times for transient crashes; if a page keeps crashing on load, it stops and waits for you to reload manually, so you never get stuck in a reload loop.

## How it is built (and why it's private by design)

VMark creates the platform webview itself and adds it as a native child of the window — it does **not** ask the app framework for one. That matters for privacy: a framework-created webview would inject an internal messaging bridge into every page, handing any site a channel into the app. Because VMark owns a freshly-constructed webview with no such bridge, **a browsed page has no channel into VMark**. The page is driven strictly one-directionally (the app can read and act on the page; the page cannot reach back).

Sessions (logins, cookies) persist per profile in the OS webview's own data store, so you log into each site once. VMark stores no credentials itself.

## Driving the browser with AI

An AI assistant connected over [MCP](./mcp-tools) can operate the browser tab:

- **Read** — get a structured accessibility snapshot of the page (each interactive or structural element as a role + accessible name).
- **Act** — click or type by ARIA **role + accessible name** (for example, click the link named "Learn more"), so the AI targets elements the way a person reading the page would.
- **Open** — create an AI-owned tab and load an HTTP(S) URL.
- **Navigate** — navigate an AI-owned tab and wait for its navigation ticket.
- **Wait** — wait for a specific navigation ticket without starting another load.
- **Screenshot** — get a JPEG image of the page's current rendering, so the AI can see layout and rendered state that the accessibility snapshot does not name. Like *Read*, it is non-mutating: allowed on an AI-owned tab, and on a human tab only while you have attached it.

AI browser posture is configured under **Settings → Advanced → Embedded Browser**:

- **Sandbox** (recommended) uses one shared, non-persistent AI webview store. It shares
  cookies with other sandbox tabs, but not with human tabs.
- **Shared profile** uses the human webview store and asks for destination approval before
  each AI navigation unless that origin has a matching `navigate` grant.

AI-created tabs are transient and are not restored after restart. Their URLs, mode, title,
generation, and loading state appear in `session.get_state`; credentials are redacted from
MCP responses.

Actions are **approval-gated**: an operation you haven't authorized is not performed — the AI is told approval is required and waits. File uploads are **never** permitted for the AI (an AI-chosen file upload would be a data-exfiltration path); those stay strictly human-driven.

### Approving an action

When the AI asks to act, VMark raises a prompt and pauses the page. It tells you exactly three things — the **site**, the **action**, and the **element** (its role and its accessible name, e.g. `button "Publish"`):

- **Allow once** — authorizes exactly that one action, on that element, on that page. It is spent immediately and does not become standing permission.
- **Allow on this site** — the AI may perform *that operation* on *that site* without asking again. It does not widen to other operations or other sites.
- **Deny** — nothing happens. Pressing `Escape`, or just hitting `Enter`, also denies: the prompt is deliberately biased toward refusing.

The prompt shows you a **description of the action, not a picture of the page** — and that is on purpose. A web page controls its own pixels, so a hostile one could style a "Delete everything" button to look like "Publish". What VMark shows you is the exact thing the security gate enforces, taken from the browser engine rather than from the page's own claims about itself.

Permission also **lapses when the page navigates**. A prompt describes an action on a *specific* page; if the page changes while you're deciding, the request is dropped rather than applied to whatever loaded instead. An unspent "Allow once" is discarded the same way.

This includes navigation *within* a page. Most modern sites move between views without ever loading a new page — the address changes, the content is rewritten, but the site never leaves. That matters here, because the site and the origin stay the same while the `button "Publish"` you approved may no longer be the button under that name. So VMark treats an in-page navigation exactly like any other: authorization lapses with the **view** it was granted against, not merely with the page.

What carries the weight, though, is the descriptor itself. A site can rewrite its own content at any moment without navigating at all, and no browser engine reports that. So what an "Allow once" authorizes is precisely one operation, on one element identified by its role and accessible name, on one site — and it is spent immediately. "Allow on this site" is the one to think twice about: it is a standing permission for that operation on that site, and a site you grant it to is a site you are trusting with it.

### Reviewing and revoking permissions

**Settings → Advanced → Site permissions** lists every site you've granted, and what it may do. **Revoke** takes it back immediately — the next AI action on that site asks again.

Site permissions are held in memory only: they are **never written to disk** and they lapse when VMark quits. Letting an AI keep the ability to click on a site across restarts is a bigger promise than it looks, so VMark doesn't make it silently.

When an AI targets a human-created tab, VMark first asks whether to attach AI access to
that tab. The attachment is bound to the current navigation generation. **Allow once** is
spent after one successful read or action; **Allow until navigation** expires on the next
full or in-page navigation, close, disable, or restart.

AI navigation rejects loopback, private-LAN, link-local, metadata, malformed, and
unsupported-scheme targets by default. DNS rebinding remains a WebKit-owned limitation;
VMark does not claim to eliminate it.

## Co-driving: watch an AI drive the browser from the terminal

The browser is a pane, not a mode. That makes a particular workflow possible: open a **terminal** (`Ctrl + \``) beside a browser tab, run an AI agent in it, and watch the page respond as it works.

The terminal and the browser sit **side by side** — the browser resizes to make room rather than being covered. So you see the page the whole time the agent is operating on it, and every action it takes still has to come past you (see *Approving an action* above).

This is the intended shape of AI browser use in VMark: the agent proposes, the page is visible, and you approve. It is not the agent working in a window you cannot see.

## When a page fails to load

An offline network, a bad hostname, a rejected certificate, or a refused connection all
produce a message in the browser pane saying what went wrong, with a **Try again**
button. Earlier builds showed a blank pane instead, which was indistinguishable from a
page that was merely slow.

## Current limitations

- macOS only in this build.
- JavaScript `confirm()` / `prompt()` dialogs are suppressed for now (only `alert()` is surfaced); pop-ups (`window.open`) are blocked rather than opened as new tabs.
- Downloads, printing, and per-request network policy are not yet implemented.

These are being filled in incrementally; the page above describes what works today.
