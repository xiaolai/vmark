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

## Using it

Running **New Browser Tab** opens a browser tab with a start page. The tab has a compact chrome bar:

| Control | Action |
|---------|--------|
| ‹ / › | Back / forward through the tab's history |
| ⟳ | Reload the current page |
| Address bar | Type a URL (or a term) and press Enter to navigate |

The address bar tracks the page automatically: if a site redirects, or a link takes you elsewhere, the bar updates to show where you actually are.

### If a page crashes

If a page's web content process dies, the tab shows a **"This page crashed"** overlay with a **Reload** button instead of a blank or frozen view. VMark auto-reloads a few times for transient crashes; if a page keeps crashing on load, it stops and waits for you to reload manually, so you never get stuck in a reload loop.

## How it is built (and why it's private by design)

VMark creates the platform webview itself and adds it as a native child of the window — it does **not** ask the app framework for one. That matters for privacy: a framework-created webview would inject an internal messaging bridge into every page, handing any site a channel into the app. Because VMark owns a freshly-constructed webview with no such bridge, **a browsed page has no channel into VMark**. The page is driven strictly one-directionally (the app can read and act on the page; the page cannot reach back).

Sessions (logins, cookies) persist per profile in the OS webview's own data store, so you log into each site once. VMark stores no credentials itself.

## Driving the browser with AI

An AI assistant connected over [MCP](./mcp-tools) can operate the browser tab:

- **Read** — get a structured accessibility snapshot of the page (each interactive or structural element as a role + accessible name).
- **Act** — click or type by ARIA **role + accessible name** (for example, click the link named "Learn more"), so the AI targets elements the way a person reading the page would.

Actions are **approval-gated**: an operation the you haven't pre-authorized is not performed — the AI is told approval is required and waits. File uploads are **never** permitted for the AI (an AI-chosen file upload would be a data-exfiltration path); those stay strictly human-driven.

## Current limitations

- macOS only in this build.
- JavaScript `confirm()` / `prompt()` dialogs are suppressed for now (only `alert()` is surfaced); pop-ups (`window.open`) are blocked rather than opened as new tabs.
- Downloads, printing, and per-request network policy are not yet implemented.

These are being filled in incrementally; the page above describes what works today.
