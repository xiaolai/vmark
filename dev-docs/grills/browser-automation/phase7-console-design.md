# Phase 7 design review — console capture vs. the no-bridge invariant

> Status: **design review (WI-P7.1 gate).** The plan requires this before building,
> because console capture is "more invasive — needs a page-world console shim."
> This document is that review: it states the tension, evaluates the options, and
> makes a go/no-go recommendation.

## The requirement

WI-P7.1: capture the tab's `console.*` output (log/info/warn/error/debug) so an AI
debugging a page it drives can see what the page logged. Read-class, sandbox-scoped,
opt-in.

## The tension

Two load-bearing invariants of the embedded browser fight this feature:

1. **No bridge (SPIKE-1 / R3).** VMark constructs the `WKWebView` itself precisely so
   *no* message handler is injected into any page — "a browsed page has no channel
   into VMark." The obvious console-capture recipe (override `console.*` in the page
   and forward each call through a `WKScriptMessageHandler`) **adds exactly the
   channel the whole design exists to deny.** That recipe is disqualified.
2. **Isolated-world driving (R10 / I2).** Every driver script runs in
   `WKContentWorld("vmark-agent")`, isolated from the page's JS globals. But
   `console` and its output live in the **page world**. The isolated world cannot
   read a page-world global, so it cannot see the page's console by reading globals.

So: the data we want is page-world; our reader is isolated-world; and the naive
bridge is forbidden.

## Options

| Option | Mechanism | No-bridge? | Verdict |
|---|---|---|---|
| A. Message handler | page-world `console` override → `WKScriptMessageHandler` → Rust | **NO** — creates a page→app channel | Rejected — breaks R3 |
| B. Native console delegate | a private/unstable WebKit console API | n/a | Rejected — no stable public macOS API |
| C. **DOM ring-buffer** | page-world `WKUserScript` overrides `console.*` and appends to a hidden DOM node (a ring buffer); the isolated-world driver **reads that DOM node** (the DOM is shared across content worlds) | **YES** — no message handler; the page-world shim writes to DOM the page already controls | **Recommended** |

### Why C preserves the invariant

The DOM is shared between content worlds; page-world globals are not. Option C puts
the buffer in the **DOM** (a hidden element), so:
- The page-world shim needs no channel to VMark — it writes to an element.
- The isolated-world driver reads that element with the existing eval primitive — no
  new channel either way.
- No `WKScriptMessageHandler` is ever registered. R3 holds.

### What C costs

- It requires injecting a **page-world `WKUserScript`** at tab creation — the first
  page-world injection in the codebase (today VMark injects only isolated-world
  scripts). That is a real, if small, expansion of surface area and must be:
  - **opt-in** and **sandbox-mode only** (never on a human/shared tab — we don't
    reshape a human's page), and
  - **best-effort + untrusted**: the shim lives in the page's own world, so a hostile
    page can clear, forge, or flood the buffer. Captured console output is
    **page-controlled data** and must be treated exactly like a `read` result — never
    trusted, never fed into an `act` target. (This is already the posture for read.)
- The buffer must be **bounded** (ring buffer, capped entries + capped per-entry
  length) so a chatty or hostile page can't grow the DOM without limit — the same
  untrusted-client discipline the Phase 5 review forced on `execute_js`.

## Recommendation

**Go, via Option C, as a two-part delivery:**

1. **Testable core (buildable + unit-tested now, jsdom):**
   - `consoleShim.ts` — the page-world shim source: override `console.*` to push
     `{level, ts, text}` into a **capped ring buffer** on a hidden DOM node, and a
     reader that returns + optionally clears it. Its buffer/override/cap logic is pure
     DOM and unit-testable in jsdom.
   - `browserConsole.ts` — a **read-class** handler (`runReadClass`) that evals the
     reader in the isolated world, parses the JSON, and returns the entries. No new
     op (read authorization; a human tab needs an attachment — but see sandbox-only).
   - Sidecar `console` action + `BridgeRequest` type + docs.
2. **Native injection (live-E2E):** register the shim as a page-world `WKUserScript`
   at `AiSandbox` tab creation only, behind the opt-in flag. This is the part that
   makes the buffer actually populate, and — like Phase 6's cookie capture — is
   verified against the running app, not unit-tested.

This keeps the security posture intact (no bridge, untrusted output, bounded buffer,
sandbox-only) while delivering the read handler and shim logic as tested code.

## Explicitly out of scope (future work, per plan)

Read-only **network observation** (a request/response ring buffer à la the Tauri MCP
`ipc_monitor`) — real native effort, its own plan. Not console, not here.
