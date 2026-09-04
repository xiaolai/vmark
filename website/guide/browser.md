# Embedded Browser

VMark can host a real web browser **inside** a document window — a web page becomes a first-class tab alongside your markdown documents. It is a genuine native webview (macOS `WKWebView`), not an external Chrome window and not an embedded frame.

::: warning Experimental
The embedded browser is an early feature and is **macOS-only** in this build. Windows and Linux support comes later — on those platforms the settings below do not appear at all.
:::


::: info Workspace rail
With the experimental [workspace rail](/guide/workspace-rail) enabled, browser pages are **window-global**: they stay reachable from every workspace in the window and are never tied to a single workspace's tabs.
:::

## Turning it off

The browser is **on by default** on macOS. **New Browser Tab** is in the **File**
menu (`Alt + Mod + Shift + B`) and in the command palette — nothing needs
enabling first.

To switch it off, go to **Settings → Advanced** and turn off **Embedded
browser**. That closes any open browser tabs, revokes every site permission the AI
had accumulated, and withdraws the AI automation surface described below.

Two AI posture settings sit directly under the toggle and appear only while it
is on. Both ship conservative and are unchanged by the browser being enabled:

| Setting | Default | Meaning |
|---|---|---|
| **AI session** | Sandbox | AI-driven pages get an isolated session rather than sharing your logged-in one |
| **Allow loopback** | Off | AI navigation to `localhost` / private-network addresses is refused |

Site permissions are not in Settings — they live in the browser sidebar, in the
window that owns them.

## Using it

A browser tab opens in the editor area, alongside your documents — the sidebar, tab strip, terminal, and status bar all stay where they are. Its controls sit **above the page**: on macOS they share the window's title bar, since VMark draws that itself. Where the system draws the title bar instead (Windows, Linux), they sit inside the window above the page, the way every other desktop browser arranges them.

| Control | Action |
|---------|--------|
| ‹ / › | Back / forward. Greyed out when there is nowhere to go |
| ⟳ / ✕ | Reload, or stop a load in progress |
| Address bar | An **omnibox**: type a URL to go there, or anything else to search |
| ☆ / ★ | Bookmark this page |

The address bar tracks the page automatically: if a site redirects, or a link takes you elsewhere, the bar updates to show where you actually are.

**A tab keeps its page when you switch away.** Looking at a document and coming back does not reload the page or lose what you had typed into it — the page is only hidden, and it is torn down when you close its tab. That is also what lets an AI keep working in a browser tab while you write (see *Co-driving* below).

If a page tries to open a pop-up window (`window.open`, a `target="_blank"` link), VMark blocks it and shows the blocked address along the top of the page with an **Open in new tab** button, so a login that insists on a pop-up is one click away instead of a click that did nothing.

## The sidebar follows the tab

When a browser tab is active, the sidebar shows **browsing history** and **bookmarks**. When you switch back to a document, it shows the file explorer, outline, and file history again — automatically. There is no second mode to keep in sync, and each side remembers what you last had open, so a glance at a browser tab does not cost you the file tree you were using.

**History** is per-window and lives only for the session: it is never written to disk. (There is still a **Clear** button — "it goes away when you quit" is not the same as "you can get rid of it now.") A reload does not add a duplicate entry, and a site that redirects you records the page you *meant* to visit rather than every hop along the way.

**Bookmarks** do persist. They are stored under the exact URL you bookmarked — same page, different section (`#install` vs `#usage`) are two bookmarks, and VMark will not quietly "tidy" a URL's query parameters, because a rewritten URL may not take you back to what you saw.

## The window goes neutral around a page

VMark's themes are deliberately tinted — Paper is a warm grey, Mint and Sepia more so. That is pleasant to write in, and wrong to wrap around someone else's web page: a coloured frame shifts how you read every colour inside it, which is why no real browser tints its own chrome.

So when a browser tab is focused, the surrounding window switches to a plain neutral — **white in a light theme, dark in a dark one** — and switches back the moment you return to a document. Your theme is unchanged; only what surrounds a web page is.

**The terminal follows the same rule.** If you have a terminal open beside a browser tab, it takes the matching neutral rather than staying your theme's colour, so the two halves of the window agree instead of meeting at a visible seam. A dark theme gets a dark terminal, not a white one — the colours in a terminal are tuned against its background, and forcing white would make a dark theme's output hard to read.

### If a page crashes

If a page's web content process dies, the tab shows a **"This page crashed"** overlay with a **Reload** button instead of a blank or frozen view. VMark auto-reloads a few times for transient crashes; if a page keeps crashing on load, it stops and waits for you to reload manually, so you never get stuck in a reload loop.

## How it is built (and why it's private by design)

VMark creates the platform webview itself and adds it as a native child of the window — it does **not** ask the app framework for one. That matters for privacy: a framework-created webview would inject an internal messaging bridge into every page, handing any site a channel into the app. Because VMark owns a freshly-constructed webview with no such bridge, **a browsed page has no channel into VMark**. The page is driven strictly one-directionally (the app can read and act on the page; the page cannot reach back).

Sessions (logins, cookies) persist per profile in the OS webview's own data store, so you log into each site once. VMark stores no credentials itself.

## Driving the browser with AI

An AI assistant connected over [MCP](./mcp-tools) can operate the browser tab:

- **Read** — get a structured accessibility snapshot of the page (each interactive or structural element as a role + accessible name, plus a stable **ref** handle like `e5`). The snapshot walks open shadow roots and says honestly what it could not reach (closed shadow roots, frames) and whether it was cut off by its size caps.
- **Act** — click or type a target, either by its precise **ref** from a prior read, or by ARIA **role + accessible name** (for example, click the link named "Learn more"). A ref is only honored for an already-granted action; anything that needs your approval uses role + name, so the prompt can show you a readable element. A click **verifies that it actually landed**: it scrolls the target into view, requires it to be visibly rendered — a duplicate button inside a collapsed section is skipped, not clicked — and hit-tests the click point, so a target covered by an overlay is reported back as "covered by …" rather than clicked through. When several visible elements share the same role and name, the click is **refused as ambiguous** rather than resolved by whichever came first in the page — a page cannot slip its own "Learn more" link in front of the site's. The AI is told what *happened*, not merely that it tried, so it can't quietly act on the wrong thing and report success. File inputs are never clicked.
- **Scroll** — bring an element (by ref) into view, or scroll by a pixel amount. Act-class (approval-gated like Click); the approval binds the exact scroll asked for.
- **Key** — send a keypress (`Enter`, `Escape`, `Tab`, arrows, with optional Ctrl/Shift/Alt/Meta) to a focused element or a ref — for example, submit a form or dismiss a dialog. Act-class, and the approval binds the exact key and modifiers. Enter inside a form submits it and Tab moves focus, the way real input would; other keys are **synthetic** DOM events, so a site that only trusts real hardware input may ignore them.
- **Query** — structured DOM detection the accessibility snapshot can't name (tables, computed values, attributes) by CSS selector. Read-class.
- **Extract** — the page as reader-mode Markdown (title, byline, article prose, boilerplate stripped), for pages the AI wants to *read* rather than operate. Site plugins refine the extraction per origin — the built-in Wikipedia plugin strips wiki chrome by name — with a generic reader as the fallback. The page only exports bytes; the extraction runs in VMark. Read-class.
- **Style** — CSS manipulation (dismiss a blocking overlay, highlight a target) by setting inline styles, toggling classes, or injecting a `<style>` block (page-wide, not selector-scoped). Act-class, and the approval binds the exact styling — it can't be swapped for other CSS after you allow it.
- **Execute JS** — the escape hatch: run a script for what the structured verbs can't express. It runs in the **isolated content world** (DOM + CSS, **never** the page's own JavaScript), is approved **per call** (never remembered — there is no "Allow on this site" for it), and its result is treated as **untrusted**. The approval prompt shows you the **exact script**, and that script is what runs — the AI cannot get you to approve one script and then run another. Prefer Query/Style; reach for this only when they fall short.
- **Session save / load** — save the tab's current session under a **handle** (a name you approve), and later restore it so a flow starts already-signed-in — *without the AI ever seeing your cookies or tokens*. The values are stored in the **OS keychain** (encrypted at rest), and the AI receives only the handle and a count summary. Both save and load are **approved per call**, and an approval for one handle can't be spent on another. A restore only applies to a page on the **same origin** it was saved from. This is credential-**by-reference**: the AI names a session, VMark holds the secret.
- **Console** — read the page's captured `console.*` output (log/warn/error…), **plus uncaught errors and unhandled promise rejections** — the signal a page emits when its own script breaks, which plain `console` logging never shows — so the AI can debug a page it's driving. Read-only, AI-owned tabs only (your own tabs carry no capture shim), and the output is treated as **untrusted** page data. This is built to preserve the private-by-design guarantee: the capture writes into the page's own DOM and VMark reads it from there, so no messaging channel is opened back into the app.

::: tip Session save/load — scope
A saved session covers **`localStorage` and cookies**, both scoped to the origin the
page was committed to when you saved it. Cookies are read and replayed through the
native cookie store and are **domain-scoped in both directions** — saving never copies
your whole cookie jar, and restoring never plants a cookie under an unrelated site.
:::
- **Open** — create an AI-owned tab, bring it to the front, and load an HTTP(S) URL. At most eight AI-owned tabs can be open at once, and the AI **closes** its own tabs when it is done (closing is never gated — stopping is always allowed). Optionally the tab opens against a **named profile**, a persistent context so a login can be reused by name; opening one asks you fresh each time, and the AI never sees the credentials.
- **Navigate** — navigate an AI-owned tab (bringing it to the front) and wait for its navigation ticket. When the page that loads reads as a **gate** rather than the content asked for — a login wall, a consent interstitial, a human-verification challenge (reCAPTCHA/Turnstile), or a rate-limit notice — the result says so, and the AI is told to **involve you** rather than try to work around it. Detection is precision-first: a price that mentions "$429" or a footer that says "Cloudflare" does not trip it.
- **Wait** — wait for a specific navigation ticket without starting another load.
- **Wait for** — poll until a condition holds (an element by ref or role + name, a piece of visible text, or the tab's **URL containing** a substring — the last confirms a click-triggered navigation landed; the query string and fragment are never matched, because a token a redirect planted there must not be probeable) or a timeout elapses, reporting whether it matched. Makes a multi-step flow deterministic — act, then wait for the result, then read — instead of guessing. Neither *Wait* nor *Wait for* changes which tab you are looking at.
- **Screenshot** — get a JPEG image of the page's current rendering, so the AI can see layout and rendered state that the accessibility snapshot does not name. Like *Read*, it is non-mutating: allowed on an AI-owned tab, and on a human tab only while you have attached it. A tab that is not the visible page may render blank.
- **Run a workflow** — replay a short, saved sequence of steps (click / type / navigate / extract, written in a small text grammar and passed in as `source`) as one **asynchronous run**: it returns a run id immediately and you poll its status, because a multi-step run outlives a single request. Every step inside it is **individually approval-gated** exactly like a hand-issued action — a workflow is not a way around the prompts — and steps the AI can't perform deterministically (a free-prose "goal", a "confirm") pause the run for it to handle by hand. To continue after a pause, the paused step is done by hand and a new run **resumes** from the paused one: it inherits the completed steps and treats the paused step as done, so nothing is submitted twice; a re-run of the same workflow with the same inputs also skips write steps that already succeeded. Runs are bounded (running time only — time spent waiting on you does not count), one at a time per tab, and can be cancelled — cancelling is always allowed, even while a step is waiting for your approval, and taking over the browser yourself stops the run.
- **Record a workflow** — instead of writing the grammar by hand, you can **record** one: with your approval (asked fresh each time — recording is never a standing permission), VMark captures the **clicks and field edits** you perform on the tab and hands back ready-to-run workflow text. It is **value-free by construction**: nothing you type is saved — every field becomes a named `{input}` you fill in at replay, a password field becomes a manual `confirm:` step, and URLs are stripped to origin + path. It records *which* controls you touched, never *what* you entered.

AI browser posture is configured under **Settings → Advanced**:

- **Sandbox** (recommended) uses one shared, non-persistent AI webview store. It shares
  cookies with other sandbox tabs, but not with human tabs.
- **Shared profile** uses the human webview store and asks for destination approval before
  each AI navigation unless that origin has a matching `navigate` grant.

AI-created tabs are transient and are not restored after restart. Their URLs, mode, title,
generation, and loading state appear in `session.get_state`; credentials are redacted from
MCP responses.

Actions are **approval-gated**: an operation you haven't authorized is not performed — the AI is told approval is required and waits. File uploads are **never** permitted for the AI (an AI-chosen file upload would be a data-exfiltration path); those stay strictly human-driven.

### Approving an action

When the AI asks to act, VMark raises a prompt and pauses the page. It tells you the **site**, the **action**, and the **element** (its role and its accessible name, e.g. `button "Publish"`) — and, for an action that carries content, the content itself: the text a *Type* will enter, the key a *Key* will press, the exact script a *Run script* or *Style* will run. That is what the approval binds; a retry with different content asks again.

- **Allow once** — authorizes exactly that one action, on that element, on that page. It is spent immediately and does not become standing permission.
- **Allow on this site** — the AI may perform *that operation* on *that site* without asking again. It does not widen to other operations or other sites.
- **Deny** — nothing happens. Pressing `Escape`, or just hitting `Enter`, also denies: the prompt is deliberately biased toward refusing. An **Allow** in the first half-second after a prompt appears is ignored, and a press has to start and end on the same prompt — so a prompt that is withdrawn under your finger cannot hand your click to the next one.

The prompt shows you a **description of the action, not a picture of the page** — and that is on purpose. A web page controls its own pixels, so a hostile one could style a "Delete everything" button to look like "Publish". What VMark shows you is the exact thing the security gate enforces, taken from the browser engine rather than from the page's own claims about itself.

Permission also **lapses when the page navigates**. A prompt describes an action on a *specific* page; if the page changes while you're deciding, the request is dropped rather than applied to whatever loaded instead. An unspent "Allow once" is discarded the same way.

This includes navigation *within* a page. Most modern sites move between views without ever loading a new page — the address changes, the content is rewritten, but the site never leaves. That matters here, because the site and the origin stay the same while the `button "Publish"` you approved may no longer be the button under that name. So VMark treats an in-page navigation exactly like any other: authorization lapses with the **view** it was granted against, not merely with the page.

What carries the weight, though, is the descriptor itself. A site can rewrite its own content at any moment without navigating at all, and no browser engine reports that. So what an "Allow once" authorizes is precisely one operation, on one element identified by its role and accessible name, on one site — and it is spent immediately. "Allow on this site" is the one to think twice about: it is a standing permission for that operation on that site, and a site you grant it to is a site you are trusting with it.

### Reviewing and revoking permissions

The **browser sidebar** (in the window that owns them) lists every site you've granted, and what it may do. **Revoke** takes it back immediately — the next AI action on that site asks again. Permissions belong to the window they were granted in.

Site permissions are held in memory only: they are **never written to disk**, they lapse when VMark quits, and switching the browser off revokes them all. Letting an AI keep the ability to click on a site across restarts is a bigger promise than it looks, so VMark doesn't make it silently.

When an AI targets a human-created tab, VMark first asks whether to attach AI access to
that tab. The attachment is bound to the current navigation generation. **Allow once** is
spent by the first read or action the browser engine authorizes (a click that then turns
out to be covered or hidden still spends it); **Allow until navigation** expires on the
next full or in-page navigation, close, disable, or restart. Until you attach a tab, the
AI sees only its origin — not its title or path. If attaching fails (the driver refused,
or the page moved while you were deciding), the prompt stays open and says so; you can
try again or deny.

AI navigation rejects loopback, private-LAN, link-local, metadata, malformed, and
unsupported-scheme targets by default, and on AI-owned tabs a content rule list applies
the same refusal to what a page embeds — frames, images, scripts, fetches — so a public
page cannot use the AI's tab to reach your network. Before an AI-initiated `open` or
`navigate` is issued, VMark also resolves the destination's hostname and refuses the
navigation (`SSRF_BLOCKED`, `reason: resolves-private`) when any answer is one of those
blocked addresses, or (`reason: unresolved`) when the name does not resolve within a
bounded wait — a public-looking name that points at your LAN or a cloud metadata service
is caught before WebKit sends a request. Two limits remain, stated plainly: the
pre-flight covers the navigations the AI issues, not redirect targets, in-page link
clicks or what a page embeds (those stay URL-text checks plus the content rule list for
literal private addresses), and a DNS answer that changes after the pre-flight
(rebinding) is not re-checked, because WKWebView exposes no per-request hook for the
address a connection actually uses.

## Co-driving: watch an AI drive the browser from the terminal

The browser is a pane, not a mode. That makes a particular workflow possible: open a **terminal** (`Ctrl + \``) beside a browser tab, run an AI agent in it, and watch the page respond as it works.

The terminal and the browser sit **side by side** — the browser resizes to make room rather than being covered. So you see the page the whole time the agent is operating on it, and every action it takes still has to come past you (see *Approving an action* above).

This is the intended shape of AI browser use in VMark: the agent proposes, the page is visible, and you approve. It is not the agent working in a window you cannot see.

**Taking back control is one gesture.** While an AI workflow run is driving a tab, its chrome shows an **"AI is controlling — click to take over"** indicator. Clicking it — or simply interacting with the page or its address bar yourself — reclaims the tab immediately and stops the run. You never have to find a stop button in the agent's terminal; touching the browser is the stop button.

## When a page fails to load

An offline network, a bad hostname, a rejected certificate, or a refused connection all
produce a message in the browser pane saying what went wrong, with a **Try again**
button. Earlier builds showed a blank pane instead, which was indistinguishable from a
page that was merely slow.

## Current limitations

- macOS only in this build.
- JavaScript `alert()` and `confirm()` dialogs are shown and answered by you; `prompt()` is suppressed for now. Pop-ups (`window.open`) are blocked, with the blocked address offered as a new tab.
- Downloads, printing, and per-request network policy are not yet implemented. Hover and drag actions have no AI verb yet.

These are being filled in incrementally; the page above describes what works today.
