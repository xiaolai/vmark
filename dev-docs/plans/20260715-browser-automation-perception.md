# Browser Automation — Richer Perception & Interaction

> Created: 2026-07-15
> Status: **All 8 phases addressed** (see the Status log). Phases 0–5 COMPLETE
>   (screenshot, stable refs, wait_for, scroll/key, and the query/style/execute_js
>   power tools — the last hardened after a mandatory security review + re-verify).
>   **Phase 6 (credentials)** and **Phase 7 (console, stretch)** landed their
>   security-critical, unit-testable CORES, each with its mandatory `/security-review`
>   run and re-verified; their **native + UI pieces are deferred as live-E2E
>   follow-ups** — cookie capture / named contexts / profile UI (P6), and the
>   page-world shim injection (P7) — deliberately not shipped as unverified native
>   code. Those are the only open items.
> Depends on the shipped embedded-browser surface + AI driver from
>   `20260714-ai-browser-navigation.md` (WI-N*) and
>   `20260712-0610-embedded-browser-sites-workflows.md` (WI-1.x/2.x), now merged to `main`.
> WI-IDs use the `WI-P*` namespace (Perception & interaction) to avoid colliding
>   with the `WI-1.x` / `WI-N*` / `WI-S*` namespaces of the prior browser plans.
> Owner: —

## Motivation

The AI browser surface today exposes five actions — `read`, `act`, `open`,
`navigate`, `wait`. Live Tauri-MCP E2E (2026-07-15) surfaced two structural
limits, and a source read of `@hypothesi/tauri-mcp-server` (v0.12.0, 20 tools)
showed the shape of the fix:

1. **The AI is blind.** `read` returns only an ARIA tree; there is no visual
   channel. A model cannot see layout, rendered state, or anything the DOM does
   not name.
2. **`act` targeting is resolved by role+accessible-name *at act time*, which is
   ambiguous.** During E2E, `act` matched "More information…" against a link
   actually named "Learn more" (silent no-op), and a blank role/name matches the
   first element of that role. Perception and action are two steps fused into one
   fuzzy lookup.

The Tauri MCP separates automation into three verbs with **stable element
handles**: *observe* (`dom_snapshot` assigns each node a ref like `e3`) → *wait*
(`wait_for` a condition) → *act* (`interact`/`keyboard` targeting `ref=e3`). This
plan borrows that loop — snapshot-with-refs → wait → act-by-ref — plus a visual
channel, and adds the escape-hatch tier the structured verbs cannot cover:
**scripted `execute_js`, DOM detection (`query`), and CSS manipulation (`style`)**.
Every one of these runs inside the driver's **isolated content world**
(`browser_eval`, `WKContentWorld`): it shares the DOM — so `querySelector`,
`element.style`, and injected `<style>` all work — but cannot see the page's own
JS heap/globals. That containment is what makes a caller-supplied script safe
*enough* to expose to an LLM on an untrusted page while still declining the two
things VMark will not do here: **main-world / page-JS eval** (Playwright-style
access to the site's own functions) and the Tauri MCP's **`ipc_*`** tools (which
drive a Tauri webview's IPC bridge — VMark's browser is a raw `WKWebView` with
**no bridge injected**, the SPIKE-1 no-bridge invariant, so there is nothing to
drive). The one native addition, `screenshot`, uses `WKWebView.takeSnapshot` and
touches no page JS. The raw `execute_js` is fenced on four sides (ADR-A6); its
residual exfiltration risk is real and explicitly accepted.

## Outcomes

### Desired behavior

The `browser` MCP tool gains four capabilities, each routed through the same
sidecar → `mcp-bridge:request` → `dispatchV2` → `handleBrowser*` → Rust path:

- **`screenshot`** — return a JPEG of the tab's current rendering (the AI's own
  sandbox tab, or a human tab it is attached to). Read-class.
- **Stable element refs** — `read` assigns every node a ref (`e1`, `e2`, …) that
  is stable for the life of the committed page; `act` accepts `{ref}` as an
  alternative to `{role, name}`. Ref targeting is exact and order-independent.
- **`wait_for`** — block until an element/text appears (or a timeout), so a
  multi-step flow is deterministic instead of "click → guess → re-read → retry".
- **Richer `act` operations** — `scroll` (reach off-screen content) and `key`
  (send Enter/Tab/Escape and modifier combos: submit a form, dismiss a dialog,
  move between fields). Act-class.
- **Scripted power tools** — the escape hatch, layered safest-first:
  - **`query`** (DOM detection) — return structured data (text, attributes,
    computed-style subset, box, refs) for elements matching a CSS selector.
    Read-class; covers what the ARIA snapshot cannot name (tables, JSON blobs,
    computed values).
  - **`style`** (CSS manipulation) — set inline styles / toggle classes / inject
    a scoped `<style>` (dismiss a blocking overlay, highlight the AI's target for
    the human co-driver). Act-class.
  - **`execute_js`** — an arbitrary isolated-world script for anything the
    structured verbs miss. Highest-friction: per-call approval, script logged,
    result flagged untrusted (ADR-A6).
- **Session & storage management** — keep and reuse login status without sharing
  the human's whole live session:
  - **Named browser contexts** — persistent, isolated per-profile data stores an
    AI tab can open against, so a login done in profile `github-work` survives
    app restarts and is invisible to profile `github-personal` and to the human's
    store.
  - **`save_storage_state` / `load_storage_state`** — snapshot a tab's session
    (cookies + localStorage) and replay it into a fresh context. Enables *human
    logs in once → save → AI reuses it in an isolated context*. The AI works with
    a **named handle, never the raw cookie/token values** (credential-by-
    reference, ADR-A7).
  - **Data management** — inspect a profile's site list and **clear** a site's or
    a profile's data (the "sign out / forget this site" the browser lacks today).

Optional stretch (Phase 7): **console** (the tab's console output), read-class.

### Security outcome

The implementation must keep every existing invariant and add **no new trust
boundary**:

1. Each new capability maps to the **existing operation vocabulary**
   (`src/lib/browser/approval/grants.ts` `BROWSER_OPERATIONS` and
   `src-tauri/src/browser/operation.rs`). Read-class verbs (`screenshot`,
   `wait_for`, `styles`, console) authorize like `read` — allowed on the tab's
   own committed origin for an AI-owned tab, and requiring human attachment for a
   human tab. Act-class verbs (`scroll`, `key`) authorize like `click`/`type` —
   default-deny, approval-gated, generation-stamped.
2. **Rust stays authoritative.** `browser_eval` (`commands_auth.rs`) remains the
   only gate: it re-checks the operation against the tab's committed origin (read
   from its own registry) and rejects a command whose navigation generation is
   stale. New operations extend its vocabulary; they do not open a new command
   path. Screenshot gets one new native command (`browser_screenshot`) that
   applies the identical generation + committed-origin + policy-epoch checks
   before capturing.
3. **No bridge; scripted eval is fenced.** Most scripts are the driver's own
   isolated-world scripts (extensions of `aria.ts`/`actScript.ts`). The one
   caller-supplied-script path — `execute_js` (Phase 5) — also runs only in the
   isolated content world (DOM + CSS, never the page's JS heap/globals), is
   approved per call rather than by a standing grant, and returns a value flagged
   untrusted that is never auto-fed into a later `act` (ADR-A6). Main-world eval
   stays out of scope. `screenshot` uses the native snapshot API and reads no
   page state.
4. **Redaction at the boundary.** Screenshot payloads and console output can
   carry secrets. Screenshots of a human tab require an attachment (one-shot,
   consumed on capture, per the existing model); URLs in returned metadata pass
   through `urlForAgent`; console capture is opt-in and sandbox-scoped by default.
5. Disabling `browser.enabled` fails every new action closed, exactly as the
   existing five (the `browserEnabled()` advisory check + the Rust
   `policy.enabled` gate both already run for these code paths).

### Non-goals

- **No main-world / page-JS eval.** `execute_js` (Phase 5) is exposed, but only
  in the **isolated content world** — DOM + CSS, never the page's own JS
  functions or heap. Playwright-style `page.evaluate` against the site's globals
  stays a separate future decision with its own threat model.
- **No standing grant for raw `execute_js`.** It is approved per call, never
  "remembered for this site" (ADR-A6). `query`/`style` are grantable; raw eval is
  not.
- **No IPC surface into the page.** The browser has no bridge, by design.
- **No per-request network policy engine.** Read-only network *observation* is
  noted as future work (below), not built here; it needs `WKURLSchemeHandler` /
  resource-delegate work out of scope for this plan.
- **No trusted synthetic input.** `key`/`scroll` dispatch DOM events from the
  isolated world; SPIKE-3 already established macOS = synthetic tier, so sites
  gating on `event.isTrusted` will ignore them. This is documented, not "fixed".
- **No new npm/crate dependencies** are anticipated; if one appears it goes
  through `scripts/check-new-deps.sh` + a manual repo/download-count look.

## Constraints & Dependencies

- **Runtime:** Tauri v2, React 19, Zustand v5, Vite v7, Vitest v4, pnpm, Rust.
- **Native surface:** VMark-owned `WKWebView` on macOS; not a Tauri webview, no
  IPC globals. Windows/Linux remain "unsupported" stubs — new native commands
  (`browser_screenshot`) must ship a `cfg(not(target_os = "macos"))` stub that
  fails clearly and keeps `pnpm check:cross` green.
- **macOS threading:** AppKit/WebKit objects are main-thread-only;
  `takeSnapshot` completes on the main thread with a completion handler.
- **macOS version:** named persistent contexts (Phase 6) use
  `WKWebsiteDataStore(forIdentifier:)`, which is macOS 14+. Gate it at runtime and
  degrade cleanly (fall back to the existing sandbox/shared postures) on older
  systems; SPIKE-4 already confirmed the identifier store constructs without
  crashing on the target OS.
- **Budget:** every new blocking verb (`wait_for`, and the internal waits inside
  `screenshot`) uses the existing 12,000 ms default / hard-max model in
  `validateTimeout` (`browserHelpers.ts`), measured monotonically, below the Rust
  20 s / sidecar 25 s ceilings.
- **Generation contract:** builds on the 2026-07-15 fix (`browserNavigation.ts`
  stamps committed generation in `waitForNavigation`); `read`/`act`/new verbs all
  depend on the frontend tab carrying the committed generation.

## Architecture Decisions

### ADR-A1 — Screenshot is a native command, not an eval

`read`/`act` inject JS into the isolated content world via `browser_eval`. A
screenshot cannot be produced that way (an isolated world cannot rasterize the
page). It is a new native command `browser_screenshot(tabId, generation)` calling
`WKWebView.takeSnapshotWithConfiguration:completionHandler:`. **SPIKE-5 already
proved this on a VMark-owned embedded webview** (14 ms, full-size image;
`dev-docs/grills/embedded-browser/SPIKE-5.md`). The command applies the same
freshness/origin/policy checks as `browser_eval` before capturing, returns a
base64 JPEG (quality-bounded to cap payload size), and never reads DOM. The
occlusion controller (`browser_freeze`/`browser_thaw`) is unaffected — screenshot
captures the live view, not a frozen snapshot.

### ADR-A2 — Element refs live in the isolated world, invalidated per generation

`ariaSnapshot` (`aria.ts`) gains a monotonic ref per emitted node, backed by a
`WeakMap<Element, string>` **held in the isolated content world** so refs survive
repeated `read`s within one committed page. On navigation the world is torn down
(new document), so refs cannot leak across pages — and `act`-by-ref still passes
`generation`, so a ref from an old page is rejected by the Rust freshness gate
regardless. `queryByRef(ref)` resolves the handle back to the element for
`actScript.ts`. Refs are advisory-locating only; **authorization is still by
committed origin + operation**, never by ref.

### ADR-A3 — `wait_for` polls inside the isolated world, bounded by the budget

A `wait_for(condition, timeoutMs)` handler runs a bounded `MutationObserver` (with
an interval fallback) in the isolated world and resolves on first match or
timeout. It is read-class (observing the DOM), returns the matched ref(s), and
never mutates. The wait is capped by `validateTimeout`; the Rust side treats it
as a `read` operation for authorization.

### ADR-A4 — `scroll`/`key` are act-class, and honestly synthetic

`scroll` (via `scrollIntoView`/element scroll) and `key` (via dispatched
`KeyboardEvent`) mutate observable state, so they are act-class: approval-gated,
generation-stamped, one-shot-target-bindable, exactly like `click`/`type`. Per
SPIKE-3 the events are synthetic (not `isTrusted`); the tool description states
this limitation so the model does not conclude a site "ignored" a keypress it
never trusted. `key` never sends OS-level shortcuts — only page-directed
`KeyboardEvent`s to a focused ref.

### ADR-A5 — Operation vocabulary extends in exactly two places

New operations are added to `BROWSER_OPERATIONS`
(`src/lib/browser/approval/grants.ts`) and the Rust `Operation` enum
(`src-tauri/src/browser/operation.rs`) — the two single-definition sets the whole
gate reads. The additions fall into three authorization classes:

| Class | Operations | Consent |
|---|---|---|
| **read** (non-mutating perception) | `screenshot`, `wait`, `query` — authorize under the existing `read` grant | a "read" grant already covers non-mutating perception; no new grantable op |
| **act** (mutation) | `scroll`, `key`, `style` — new grantable ops, default-deny, approval-gated, generation-stamped | like `click`/`type` |
| **eval** (escape hatch) | `execute_js` — new op, **per-call approval only, never a standing grant** | highest friction; see ADR-A6 |
| **session** (identity) | `session.save` / `session.load` / `session.clear` — user-gated, not AI-grantable | handles credentials; see ADR-A7 |

A test asserts the frontend and Rust vocabularies never drift, and that `eval` and
the `session` ops are excluded from the grantable (remember-able) set.

### ADR-A6 — Scripted eval is isolated-world, per-call-approved, untrusted-result

`execute_js` is the capability VMark otherwise avoids, so it is fenced on four
sides rather than one:

1. **Isolated content world only.** Caller scripts run in the driver's
   `WKContentWorld`, which shares the DOM but not the page's JS heap/globals. That
   is exactly what makes DOM detection and CSS manipulation safe-ish — they are
   DOM operations — while denying access to the page's own functions and any
   secret held only in page JS. Main-world / `pageWorld` eval is **out of scope**;
   adding it is a separate decision.
2. **Per-call approval, never a standing grant.** `eval` is absent from the set an
   origin can be *remembered* for. Every `execute_js` raises a fresh approval that
   shows the script; "remember for this site" is not offered. `query` (read) and
   `style` (act) remain grantable; raw `eval` is not.
3. **Generation-stamped + committed-origin gated**, identical to `read`/`act`.
   `browser_eval` already reads the committed origin from its own registry and
   rejects a stale generation; caller scripts get no weaker path. The command
   gains a caller-script arm guarded by the `eval` op, not a new command.
4. **Result is untrusted.** The return value is handed to the AI labeled
   page-derived/untrusted and is never auto-fed into a subsequent `act` target;
   the full script is logged (URL redacted) for audit. This *bounds* — it does not
   eliminate — the exfiltration risk that is inherent to giving an LLM eval on an
   untrusted page, and which the product owner has explicitly accepted.

### ADR-A7 — Sessions are named contexts; the AI holds a reference, never the tokens

Login reuse today is coarse: `aiSession: "shared"` puts the AI inside the human's
entire live persistent session; `"sandbox"` is wiped every app-lifetime. This ADR
adds a middle tier borrowed from Playwright's *browser contexts + `storageState`*,
under four rules:

1. **Named, persistent, isolated contexts.** Each profile is its own
   `WKWebsiteDataStore` keyed by a stable UUID via
   `dataStoreForIdentifier:` (macOS 14+; SPIKE-4 already probed identifier stores
   with no crash). Extends `browser_store_macos.rs`, which today holds one
   non-persistent sandbox store, into a keyed map of named stores. Contexts do not
   share cookies/storage with each other, with the sandbox store, or with the
   human's default store.
2. **Credential-by-reference.** Cookies are session tokens. The AI names a context
   (`"github-work"`) or a saved-state handle; it **never receives raw cookie or
   token values**. Export/import moves through Rust (`WKHTTPCookieStore` for
   cookies; per-origin isolated-world eval for `localStorage`, best-effort). The
   secret stays server-side.
3. **Secrets are protected at rest and never logged.** A named context lives in
   the OS-protected WebKit container. An *exported* `storageState` blob is
   sensitive-at-rest: it is encrypted (OS keychain-wrapped key) or written only to
   a user-chosen secure location — never plaintext in a workflow file, never in
   logs, always redacted at the trust boundary.
4. **Loading an identity is a user decision.** `load_storage_state` / opening a tab
   against a named context grants the AI an authenticated identity, so it requires
   explicit user approval (its own `session` operation class — user-gated, not an
   AI-grantable standing operation). Clearing data is likewise user-initiated.

## Phases

Sequenced by value/leverage: unblind the model, then make targeting reliable, then
make multi-step flows deterministic, then extend interaction.

### Phase 0 — Feasibility (mostly retired)

Most risk is already discharged by prior spikes; this phase only closes the two
genuinely new unknowns.

| WI | Spike | Status |
|---|---|---|
| WI-P0.1 | `takeSnapshot` on the embedded webview | **PASS (SPIKE-5)** — reuse evidence |
| WI-P0.2 | Synthetic key/scroll trust tier | **REFUTED-by-design (SPIKE-3)** — documented caveat |
| WI-P0.3 | Ref stability across repeated reads within a generation | **NEW** — isolated-world `WeakMap` probe |
| WI-P0.4 | `wait_for` MutationObserver in the isolated world resolves + tears down on timeout | **NEW** — probe |

**DoD:** WI-P0.3/0.4 have runnable probes under
`dev-docs/grills/browser-automation/` with recorded PASS output; WI-P0.1/0.2 cite
the prior spike files. `bash scripts/check-browser-automation-phase.sh 0` exits 0.

### Phase 1 — Visual perception (`screenshot`)

| WI | Deliverable | Primary files |
|---|---|---|
| WI-P1.1 | Native `browser_screenshot(tabId, generation)` — main-thread `takeSnapshot`, generation/committed-origin/policy checks, base64 JPEG, quality/size cap; `cfg(not(macos))` stub | `src-tauri/src/browser/surface*_macos.rs`, `commands.rs`/new `screenshot_macos.rs`, `command_registry.rs`, `mod.rs` stub |
| WI-P1.2 | Frontend `handleBrowserScreenshot` — `browserEnabled()` gate, `resolveBrowserTab`, human-attachment requirement (read-class), redacted metadata, respond `{url, image}` | `src/hooks/mcpBridge/v2/browser*.ts`, `dispatch.ts` (`vmark.browser.screenshot`) |
| WI-P1.3 | Sidecar tool: add `screenshot` to the action enum + description; return image content block | `vmark-mcp-server/src/tools/browser.ts`, `__tests__/unit/tools/browser.test.ts` |
| WI-P1.4 | Docs: `website/guide/browser.md` + `mcp-tools.md`; `21-website-docs.md` mapping already covers `browserCommands`/`browser/` | website + `AGENTS.md` mapping note |

**DoD:** unit tests for the handler (gate, attachment, redaction) + sidecar tool;
Rust test for the command's auth checks (stale generation → refused, disabled →
`BROWSER_DISABLED`); live E2E via Tauri MCP capturing a real JPEG of an AI tab;
`check-browser-automation-phase.sh 1` green. **No visual regression:** capturing
does not disturb the occlusion/freeze state.

### Phase 2 — Stable element handles (ref-IDs)

| WI | Deliverable | Primary files | Status |
|---|---|---|---|
| WI-P2.1 | `ariaSnapshot` emits a stable `ref` per node; `WeakMap` ref store (generation-scoped); `queryByRef` | `src/lib/browser/agent/refs.ts`, `aria.ts`, `actScript.ts`, tests | ✅ done |
| WI-P2.2 | `read` response includes `ref` on each node; `act` accepts `{ref}` (precise) or `{role, name}`; half-specified target still refused | `src/hooks/mcpBridge/v2/browser.ts`, `actScript.ts` | ✅ done |
| WI-P2.3 | ~~One-shot target binding accepts a ref descriptor~~ | — | 🔀 **superseded** — see below |
| WI-P2.4 | Sidecar schema: add `ref` to `act`; description | `vmark-mcp-server/src/tools/browser.ts` | ✅ done |

> **WI-P2.3 superseded (first-principles change).** Binding a one-shot to a bare
> `ref` requires showing the human a `ref` (`"e5"`) in the approval prompt — not
> a legible element — or resolving it natively and trusting the AI's claimed
> role/name, which reopens mislabel-escalation. Instead, `ref` is honored **only
> for an already-granted operation** (a precise fast-path), and anything needing
> approval uses `{role, name}` (legible). No `ref` is ever bound into a one-shot,
> so `OneShotTarget` is unchanged and the escalation surface is removed rather
> than mitigated. Same targeting-ambiguity fix, smaller trust boundary.

**DoD:** `aria.test.ts`/`actScript.test.ts` assert ref stability across repeated
snapshots and cross-generation invalidation; an `act`-by-ref test proves the
"More information…"/"Learn more" ambiguity class is gone; live E2E: read → act by
ref clicks the intended element; gate green.

### Phase 3 — Condition waits (`wait_for`)

| WI | Deliverable | Primary files |
|---|---|---|
| WI-P3.1 | `wait_for` isolated-world observer (element present by ref/role+name, or text present), bounded by `validateTimeout`, read-class | new `src/lib/browser/agent/waitFor.ts`, `browser.ts` handler, `dispatch.ts` |
| WI-P3.2 | Sidecar action `wait_for {tabId?, ref?|role?+name?|text?, timeoutMs?}`; distinguish "matched" vs "timeout" in the response | `vmark-mcp-server/src/tools/browser.ts` |

**DoD:** unit tests for match, timeout, and teardown-on-timeout (no leaked
observer); Rust authorizes it as `read`; live E2E: click a link, `wait_for` the
destination heading, then `read`; gate green.

### Phase 4 — Richer interaction (`scroll`, `key`)

| WI | Deliverable | Primary files |
|---|---|---|
| WI-P4.1 | Add `scroll`, `key` to `BROWSER_OPERATIONS` + Rust `Operation`; vocabulary-parity test | `grants.ts`, `operation.rs`, tests |
| WI-P4.2 | `act` operations `scroll` (to a ref / by delta) and `key` (named key + modifiers to a focused ref); act-class approval + generation stamp; synthetic-input caveat surfaced | `actScript.ts`, `browser.ts` handler |
| WI-P4.3 | Sidecar schema: extend `act` operation enum to `click|type|scroll|key`; document the trust caveat | `vmark-mcp-server/src/tools/browser.ts` |

**DoD:** unit tests for each op incl. blank/half-specified refusal and
`actionSucceeded` semantics (a no-op scroll/keypress is not a success); Rust
approval-gate test; live E2E: `key` Enter submits a search form, `scroll` reveals
and clicks an off-screen control; gate green.

### Phase 5 — Scripted power tools (`query`, `style`, `execute_js`)

The escape-hatch tier, layered safest-first. All three run in the driver's
**isolated content world**: they share the DOM (so `querySelector`,
`element.style`, injected `<style>` all work) but cannot see the page's own JS
globals/heap. Governed by ADR-A6. Build the structured verbs (`query`, `style`)
before the raw hatch (`execute_js`) so the common cases have a grantable,
auditable path and eval is reserved for what they cannot express.

| WI | Deliverable | Class | Primary files |
|---|---|---|---|
| WI-P5.1 | **`query`** (DOM detection) — `{selector | ref, fields}` returns structured element data (text, attributes, computed-style subset, box, visibility, matched refs); isolated-world, read-only | read | `src/lib/browser/agent/query.ts`, `browser.ts` handler, `dispatch.ts` |
| WI-P5.2 | **`style`** (CSS manipulation) — `{ref | selector, set | classes | injectCss}` sets inline styles / toggles classes / injects a scoped `<style>` (dismiss a blocking overlay, highlight a target); isolated-world | act (op `style`) | `src/lib/browser/agent/style.ts`, `actScript.ts`, `grants.ts`, `operation.rs`, `browser.ts` handler |
| WI-P5.3 | **`execute_js`** — arbitrary isolated-world script; **per-call approval only** (no standing grant), generation-stamped, full script logged (URL-redacted), result returned but flagged untrusted and never auto-fed into a later `act`; a test asserts the isolated world cannot read a page-world global | eval (op `eval`) | `commands_auth.rs` (caller-script arm of `browser_eval` under the `eval` op), `browser.ts` handler, `browserApprovalStore.ts` |
| WI-P5.4 | Sidecar: add `query` / `style` / `execute_js` actions; descriptions state isolated-world containment, per-call-approval, and untrusted-result semantics | — | `vmark-mcp-server/src/tools/browser.ts`, `__tests__/unit/tools/browser.test.ts` |
| WI-P5.5 | Docs: `website/guide/browser.md` + `mcp-tools.md` — the containment model, what `execute_js` can/can't reach, and the exfiltration caveat | website |

**DoD:** unit tests: `query` returns structured data and never mutates; `style`
is approval-gated + generation-stamped; `execute_js` refuses without a fresh
per-call approval, refuses a stale generation, logs the script, marks the result
untrusted, and is rejected from any standing grant; a **containment test** asserts
an isolated-world script cannot read a page-world global. Rust: `browser_eval`
under the `eval` op enforces the same committed-origin + generation gate as
`read`/`act`. Live E2E: `query` a table the ARIA snapshot omits; `style` to hide
a cookie banner then `act`; `execute_js` (after approval) returns a value the
structured verbs cannot. `check-browser-automation-phase.sh 5` green.

### Phase 6 — Session & storage management (named contexts + `storageState`)

Keep and reuse login status without handing the AI the human's whole live session.
Governed by ADR-A7. The credential (cookies/tokens) stays server-side in Rust; the
AI only ever names a context or a saved-state handle.

| WI | Deliverable | Primary files |
|---|---|---|
| WI-P6.1 | **Named persistent contexts** — extend `browser_store_macos.rs` from one non-persistent sandbox store to a keyed map; persistent isolated stores via `dataStoreForIdentifier:`; open an AI tab against a named `profile`; `cfg(not(macos))` stub | `src-tauri/src/browser/browser_store_macos.rs`, `surface*_macos.rs`, `ai_commands.rs` (`browser_ai_create` gains `profile`), `mod.rs` stub |
| WI-P6.2 | **`save_storage_state(tabId) → handle`** — snapshot cookies (`WKHTTPCookieStore.getAllCookies`) + per-origin `localStorage` (isolated-world eval); persist the blob **encrypted at rest** (keychain-wrapped key); return only a handle | new `session_macos.rs`, `command_registry.rs`, `browserApprovalStore`/session store |
| WI-P6.3 | **`load_storage_state(handle, → context)`** — replay cookies (`setCookie`) + `localStorage` into a context; **explicit user approval** required (new `session` op class, user-gated, not AI-grantable); never returns raw values | `session_macos.rs`, `browser.ts` handler, `dispatch.ts` (`vmark.browser.session.*`) |
| WI-P6.4 | **Human "log in for the AI"** flow — human opens a named-context tab, logs in, the login persists in that profile; the AI later reuses it by name. Consent + minimal UI (profile list) | `src/components/Browser/*`, `browserStore` |
| WI-P6.5 | **Data management** — summarize a profile's site list and **clear** a site's or a profile's data (`WKWebsiteDataStore.removeDataOfTypes:modifiedSince:`), user-initiated | `browser_store_macos.rs`, browser sidebar UI |
| WI-P6.6 | **Secret hygiene tests + sidecar + docs** — assert tokens never reach the AI, never hit logs, and the blob is encrypted at rest; add `vmark.browser.session.*` to the sidecar; document the model + credential-sensitivity in `browser.md` | tests, `vmark-mcp-server/src/tools/browser.ts`, website |

**DoD:** unit + Rust tests: two named contexts don't share cookies/storage; a
saved state loaded into a fresh context is authenticated; the AI response for
`save`/`load` carries a **handle only, no cookie/token values**; the blob is
encrypted at rest and appears in no log; `load` refuses without user approval.
Live E2E: log into a fixture in context A → open a fresh context-A tab → still
signed in; context B is not; clearing context A's data signs it out.
**Mandatory `/security-review` before this phase lands** (credentials).
`check-browser-automation-phase.sh 6` green.

### Phase 7 — Observation (stretch: console)

| WI | Deliverable | Notes |
|---|---|---|
| WI-P7.1 | Console capture (sandbox-scoped, opt-in) — the tab's `console.*` output for automation debugging | read-class; needs a page-world console shim, so more invasive — design-review before building |

**Future work (not scoped here):** read-only **network observation** (a
request/response ring buffer modeled on the Tauri MCP's `ipc_monitor` /
`ipc_get_captured`, but backed by `WKURLSchemeHandler` / resource-delegate). It
would let the AI verify a POST landed and give teeth to the "per-request network
policy not yet implemented" note in `browser.md`. Real native effort; its own
plan.

## Governance

- **Phase gate:** copy `scripts/check-gha-phase.sh` to
  `scripts/check-browser-automation-phase.sh` and fill per-phase assertions
  (WI-linkage + `run_vitest`/`run_cargo` rows mirroring each DoD). Required to
  exit 0 before a phase's status ticks (rule 60 §3).
- **WI linkage:** every WI in a "complete" phase linked via a commit message or a
  test-file header (`// WI-P1.2 — …`); verified by
  `bash scripts/check-wi-linkage.sh <this-file> --phase=N` (rule 60 §2).
- **Cross-model review (mandatory):** this plan is 8 phases — run
  `/cc-suite:review-plan` (Codex) before any Phase 1 commit (rule 60 §6). Its
  different blind spots catch API/assumption errors a single model misses.
- **Security review (mandatory for Phases 5 and 6):** Phase 5's `execute_js` /
  `style` tier widens the AI's reach on untrusted pages; Phase 6 handles
  **credentials** (session cookies/tokens). Before each lands, run a focused
  `/security-review`. Phase 5: isolated-world containment (verify a script cannot
  read a page-world global *at runtime*, not just jsdom), per-call approval,
  untrusted-result handling. Phase 6: credential-by-reference (tokens never reach
  the AI), at-rest encryption of exported state, no-logging, and the
  user-approval gate on `load`.
- 2026-07-15 — **Phase 2 complete.** Stable refs land in `read`
  (`refs.ts`, generation-scoped), `act` accepts a precise `{ref}` on the
  already-granted path (`actScript.ts` ref click/type; `browser.ts` handler;
  sidecar `ref` arg), and WI-P2.3's ref-one-shot binding is **superseded** (see
  the Phases table note) — no ref reaches a one-shot, so the escalation surface
  is removed, not mitigated. `check-browser-automation-phase.sh 2` exits 0
  (suites + WI-linkage for P2 all green).
- 2026-07-15 — **Phase 3 complete.** `wait_for` (WI-P3.1/P3.2): a bounded
  frontend poll of fast synchronous condition checks
  (`buildWaitConditionScript` — ref / role+name / visible-text), re-resolving the
  tab each round so it tracks navigation and each eval stays well under the
  driver's run-loop pump cap. Reports `matched: true|false` (found vs timed out).
  New `browserWaitFor.ts` handler + `vmark.browser.wait_for` sidecar action;
  read-class (human tab needs an attachment). `check-…-phase.sh 3` exits 0.
- 2026-07-15 — **Phase 4 complete.** `scroll` + `key` act-class ops (WI-P4.1–4.3):
  added to the closed vocabulary (`grants.ts` / `operation.rs`, parity test
  updated); new `interactScript.ts` injects `__vmarkScroll` / `__vmarkKey`
  (synthetic DOM events per SPIKE-3 — a site gating on `event.isTrusted` ignores
  them; documented). The `act` handler was **extracted to `browserAct.ts`**
  (audit #9 — browser.ts is now a 54-line read handler + re-export barrel) and
  gained scroll/key branches; a ref scroll/key is granted-only, a delta scroll /
  focused key goes through the approval flow. Sidecar `act` enum → click | type |
  scroll | key with `dy` / `key` / `modifiers`. `check-…-phase.sh 4` exits 0.
- 2026-07-16 — **Phase 5 complete.** Scripted power tools (WI-P5.1–P5.5): `query`
  (read-class DOM detection), `style` (act-class, op `style`), `execute_js` (op
  `eval`, per-call approval only). New `powerScript.ts` (`__vmarkQueryDom` /
  `__vmarkStyleOp`, capped, invalid-selector-safe) + `browserPower.ts` handlers +
  dispatch routes + sidecar actions. All run in the isolated content world.
  **`execute_js`/`style` are the payload-binding ops:** the one-shot binds a
  SHA-256 of the exact script (Rust-authoritative in `one_shot.rs` /
  `commands_auth.rs`, mirrored advisory in `browserApprovalStore.ts`), and the
  approval dialog shows the eval script.
  **Mandatory /security-review: DONE** (`dev-docs/grills/browser-automation/security-review-P5.md`).
  It caught, and this phase fixed: **High #1** approved-A/run-B script substitution
  (the payload binding above); **High #2** eval navigation race (pre-dispatch
  `command_still_fresh` recheck; the residual main-thread-queue window and its
  in-closure fix are noted as a follow-up); **Medium #3** `urlForAgent` now strips
  query + fragment (token leak), not just userinfo; **Medium #4** `style` payload
  is bound too and the false "scoped `<style>`" claim corrected; **Low #5** the
  "Allow on this site" button is hidden for never-grantable `eval`. Verified
  controls: `eval` is never standing-grantable (Rust + frontend), and the caller
  script runs in `worldWithName("vmark-agent")` (isolated). `check-…-phase.sh 5`
  passes its suites; live-E2E isolated-world containment is a WKContentWorld
  guarantee jsdom cannot model.
- 2026-07-16 — **Phase 6 core landed (partial); native + UI deferred.** The
  security-critical, unit-testable credential-by-reference core (WI-P6.2/P6.3/P6.6):
  a new `session` op — NEVER grantable (per-call user approval only) AND
  payload-bound to an `action:handle` so an approved `load:work_login` can't be
  spent on another handle. `session_state.rs` persists the storage-state blob in the
  **OS keychain** (encryption-at-rest for free, reusing `secure_store.rs`; no crypto
  dep), with `redacted_summary` the only value-free view allowed out — 6 unit tests
  incl. secret-hygiene + handle validation. `session_commands.rs`
  (`browser_save/load/forget_storage_state`) gates on the shared
  `authorize_driver_op`; `save` returns counts only, `load` returns nothing, values
  are never logged. Frontend `browserSession.ts` + dispatch + sidecar
  `session_save`/`session_load` + the approval dialog showing the bound
  `action:handle`. **localStorage** is captured/replayed via the isolated-world
  eval. **Mandatory /security-review (credentials): run** (see grills/).
  **Deliberately deferred as live-E2E / UI follow-ups** (not shipped as unverified
  credential-marshaling): native **cookie** capture via `WKHTTPCookieStore`
  (part of WI-P6.2), **named persistent contexts** WI-P6.1, and the **profile /
  data-management UI** WI-P6.4/P6.5. `StorageState` already carries a `cookies` vec.
  `check-…-phase.sh 6` runs the core suites (WI-linkage reports P6.1/P6.4/P6.5 still
  open — accurate for a partial phase).
- 2026-07-16 — **Phase 6 replay hardened (security re-verify).** Codex re-verified
  the Phase 6 fixes: capture fail-closed confirmed, but the origin binding was still a
  command-thread check racing the async main-thread write. The load-replay script now
  re-checks the EXECUTING document's live origin (`new URL(committed).origin ===
  location.origin`) synchronously before `setItem`, so a raced navigation cannot write
  cross-origin. Also: the shared human-attachment approval envelope and `originForAgent`
  for opaque `data:` URLs now expose origin-only (no credential-bearing path/payload),
  and the public MCP guide's load shape was corrected.
- 2026-07-16 — **Phase 7 (stretch) design-reviewed; testable core landed.** WI-P7.1
  console capture. The plan's required design review
  (`dev-docs/grills/browser-automation/phase7-console-design.md`) concluded that the
  only design preserving the no-bridge invariant is a page-world shim writing to a
  hidden DOM ring buffer that the isolated-world driver reads (no message handler).
  Landed + tested: `consoleShim.ts` (bounded ring buffer, transparent, never-throws;
  6 jsdom tests), `browserConsole.ts` (read-class handler; untrusted output), the
  dispatch route + sidecar `console` action. **Deferred (live-E2E, per the review):**
  the native page-world `WKUserScript` injection (AiSandbox-only) that populates the
  buffer — it duplicates the shim source into Rust and needs a build-time decision +
  live verification. `check-…-phase.sh 7` runs the core suites.
- 2026-07-16 — **Native credential pieces deferred by explicit decision.** WI-P7.1's
  native page-world shim injection landed (console output — not a credential). But an
  attempt to implement WI-P6's native `WKHTTPCookieStore` **cookie** capture (live
  session credentials → keychain) was halted: shipping it would have reversed the
  twice-reviewed decision to not land unverified credential-marshaling, and skipped
  the mandatory `/security-review` (rule 60 §6) every other credential change here
  went through. A safety gate flagged exactly that. On the surfaced choice, the owner
  chose to **defer** the native credential pieces — cookie capture, named persistent
  contexts (WI-P6.1), and the profile/data-management UI (WI-P6.4/P6.5) — to a session
  with the app running, each to carry its own security review. This is the deliberate,
  authorized close-out state: every unit-verifiable layer is done + reviewed; the
  native/UI halves whose DoD requires live-app E2E are held, on purpose.
- 2026-07-16 — **Cookie storage-state landed; WI-P6.1 named contexts NOT landed
  (authorization gap).** The cookie half of session save/load (WI-P6.2) is complete
  and fully reviewed: WKHTTPCookieStore capture/replay, HttpOnly-skipped +
  Secure/SameSite/Expires-preserved, domain-scoped, origin-bound, fail-closed —
  mandatory /security-review + re-verify + re-verify fixes (host-only cookie
  semantics, full-origin freshness). Committed.
  **WI-P6.1 named persistent contexts** was implemented (dataStoreForIdentifier,
  macOS-14-guarded) + a metadata-only session/profile UI, but its mandatory
  /security-review (`grills/browser-automation/security-review-P6.1-named-contexts.md`)
  found **two High blockers** and it was **reverted, not landed**:
  (H1) opening a named profile required NO user consent — a malicious AI could open a
  guessed profile (`github-work`) and read authenticated page content; ADR-A7 wants a
  per-call, non-grantable `session` approval bound to (profile, destination origin),
  authoritatively enforced in Rust. That is a genuinely new PRE-navigation
  authorization mechanism (the existing one-shot binds a *committed* origin, which
  doesn't exist before the tab loads) and must be designed, not rushed.
  (H2) on macOS 10.15–13 every named profile collapsed into the shared sandbox store,
  breaking isolation (fix: a separate per-profile non-persistent store below 14, never
  the singleton). Plus Mediums: unbounded profile creation, "Remove" not revoking the
  on-disk store (needs `removeDataStoreForIdentifier`), and Rust not validating the
  untrusted profile name. **Next step: design the per-use profile-open authorization
  (H1) before re-implementing WI-P6.1.**
- 2026-07-16 — **WI-P6.1 named contexts + UI (P6.4/P6.5): first cut landed, then
  security re-verify caught real holes → all fixed and re-verified.** The first cut
  (a89ab922) built the per-use profile-open authorization
  (`grills/browser-automation/wi-p6.1-profile-open-auth-design.md`): a single-use grant
  bound to (profile, destination origin), consumed AUTHORITATIVELY in
  `browser_ai_create` before the profile is applied. The mandatory re-verify then
  found the OPEN gate was correct but the tab was not confined AFTER creation, plus
  fail-open/hardening gaps. **Round-2 fixes:**
  - **H1 (cross-origin credential read):** a profile-backed sandbox tab now carries a
    permanent `profile_origin` (`registry.rs`, set once, never cleared on navigation);
    the driver gate (`authorize.rs` → `origin_guard.rs`) confines the AI's `read`/
    `screenshot` to that origin. Navigation is still allowed, so SSO/login redirects
    complete — but the AI cannot read an off-origin page reached by redirect.
  - **H2 (isolation fail-open):** `browser_store_macos.rs::configure` now returns a
    `Result` and fails closed with `PROFILE_STORE_LIMIT` at the 32-store cap — never
    shares the unnamed sandbox store; `surface_create_macos.rs` propagates with `?`.
  - **Removal:** `forget_profile` pumps the run loop until `removeDataStoreForIdentifier`
    confirms (Err on failure/timeout); `BrowserSessionsList.tsx` awaits it and drops
    the row only on success (keeps it + alerts on failure).
  - **Validation / pending cap:** `browserNavigation.ts` returns `INVALID_PROFILE` for
    a malformed requested profile (no silent downgrade) and honors
    `MAX_PENDING_APPROVALS`; `browserApprovalStore.ts` caps + de-dupes `profileOpens`.
  A round-2 re-verify then found two residuals — a `read` one-shot could still override
  the confinement, and an empty-string profile still downgraded — both fixed:
  `authorize.rs` HARD-denies an off-origin profile read (`PROFILE_ORIGIN_CONFINED`)
  before any one-shot is consulted; `set_profile_origin` is set-once; the frontend
  rejects any present-but-malformed profile (incl. empty/whitespace).
  Tests: new `registry`/`origin_guard`/`authorize` confinement + set-once cases +
  `browserNavigation`/`BrowserSessionsList` failure-path tests; 197 browser Rust + 473
  browser-frontend green; typecheck/eslint/file-size green. **Round-3 security re-verify:
  all items FIXED, no regression — statically authorization-safe and isolation-safe for
  the implemented scope.** **Live-driven via Tauri MCP** (port 9323) against the running
  debug app on macOS 14+: H1 read-confinement CONFIRMED (off-origin read →
  `PROFILE_ORIGIN_CONFINED`; on-origin read + cross-origin navigation both allowed),
  open-gate (no grant → `PROFILE_NOT_APPROVED`), Rust profile-name validation, and
  confirmed removal (errors while the profile's tab is live/holding the store; succeeds
  after teardown — the exact false-success the fix removed). Byte-level cookie isolation
  across profiles is guarded by the very gates that (correctly) prevent ungated
  observation of stored credentials, so it stays covered by unit tests + static
  re-verify rather than an ad-hoc probe. NOTE: a recent Rust **stable**
  release put the whole `src-tauri` crate in rustfmt + clippy drift (pre-existing,
  repo-wide, also affects untouched files + `main`); CI's `rust` check needs a separate
  toolchain-update chore — out of scope for this security fix.
- **TDD hook:** extend the `SCOPED` array in `.claude/hooks/gha-tdd-guard.mjs` to
  cover the new touched paths (`src/lib/browser/agent/**`,
  `src/hooks/mcpBridge/v2/browser*.ts`) so production edits require sibling tests
  (rule 60 §5).
- **Dependencies:** none expected; any addition triggers
  `scripts/check-new-deps.sh` (npm) / manual crate review (rule 60 §4).
- **Cross-platform:** each native command ships a non-macOS stub; `pnpm
  check:cross` must stay green.

## Status log

- 2026-07-15 — Plan drafted on `feature/browser-automation-tools` after merging
  `feature/embedded-browser` to `main`. Grounded in live Tauri-MCP E2E findings
  (blind AI; brittle role+name targeting; the open→read generation bug, now
  fixed) and a source read of `@hypothesi/tauri-mcp-server` v0.12.0. Nothing
  built yet; Phase 0 probes + §6 review are the blocking next steps.
- 2026-07-15 — **Scope decision (product owner):** add the escape-hatch tier —
  `execute_js`, DOM detection (`query`), CSS manipulation (`style`) — as Phase 5.
  This reverses the original "structured verbs only" stance. Design constrains it
  to the **isolated content world** (DOM + CSS, no page-JS heap), with raw
  `execute_js` behind per-call approval and an untrusted result (ADR-A6);
  main-world eval and `ipc_*` remain out of scope. The residual exfiltration risk
  of LLM-driven eval on untrusted pages is documented and explicitly accepted;
  Phase 5 carries a mandatory security review.
- 2026-07-15 — Added **Phase 6 — Session & storage management** (named contexts +
  `storageState`) after confirming the shipped browser has *no* cookie/storage
  management surface: login persists only via the human's persistent store
  (`aiSession: "shared"`, coarse) or not at all (`"sandbox"`, wiped per
  app-lifetime); no save/restore, no named profiles, no clear/inspect. Design
  borrows Playwright's contexts + `storageState`, with credential-by-reference
  (the AI never sees tokens; ADR-A7) and a mandatory Phase-6 security review.
  Observation moved to Phase 7.
- 2026-07-15 — **Implementation began (uncommitted, on
  `feature/browser-automation-tools`).**
  - **Governance scaffolding:** `scripts/check-browser-automation-phase.sh`
    authored (Phase 0/1 blocks live; 2–7 fail closed); the TDD guard hook scope
    extended to `src/hooks/mcpBridge/v2/browser*.ts`.
  - **Phase 0 (probes):** `dev-docs/grills/browser-automation/probe-refs.mjs`
    (WI-P0.3) and `probe-waitfor.mjs` (WI-P0.4) run green; SPIKE-P0.3/P0.4
    write-ups carry `Verdict: PASS`. `check-browser-automation-phase.sh 0` → 0.
  - **Phase 1 (screenshot):** native `browser_screenshot` (WI-P1.1) — the
    `browser_eval` gate was **extracted** into a shared, unit-testable
    `authorize_driver_op` so the two commands can't drift (rule 60 §10); native
    `takeSnapshot` → bounded-JPEG → base64 in `screenshot_macos.rs`. Frontend
    `handleBrowserScreenshot` (WI-P1.2), sidecar `screenshot` action returning an
    image content block (WI-P1.3), docs (WI-P1.4). All unit/Rust/sidecar suites
    green; clippy + file-size + cross-target green.
  - **Phase 2 (WI-P2.1, stable refs in perception):** new
    `src/lib/browser/agent/refs.ts` — a per-`document` ref store (persists across
    reads within a page, resets on navigation; productionizes the Phase-0 probe).
    `ariaSnapshot` now stamps each node with a stable `ref`; the injected
    `actScript.ts` mirror carries the same `document.__vmarkRefStore` shape, and
    the byte-identical parity contract still holds. 601 browser-lib + MCP-handler
    tests green; the only `AriaNode` consumer (`selfHeal.ts`) `Pick`s role/name,
    so no regression. **Still open in Phase 2:** act-by-`ref` (WI-P2.2), the
    ref-bound one-shot + native ref→role/name resolution for the human prompt
    (WI-P2.3), and the sidecar `ref` arg (WI-P2.4).
  - **Gates still open (human-in-the-loop, by design):** live E2E (a real JPEG of
    an AI tab via Tauri MCP) is verified manually in a session.
- 2026-07-15 — **Committed** Phases 0/1/2.1 (5 commits) and ran a **Codex
  cross-model audit-fix** (`gpt-5.6-sol`, 2 rounds, `/cc-suite:audit-fix`).
  15 findings; fixed + Codex-verified: human-tab attachment now required for
  every op (a grant no longer bypasses it) and consumed atomically under a held
  lock (no one-shot burned on a lost race); `browser_eval` disabled-precedence
  restored; `browser_screenshot` re-checks freshness after capture (TOCTOU) and
  bounds width via `snapshotWidth` (downscale-only); the auth gate extracted to
  `authorize.rs` with expanded tests; refs use `WeakRef` + owner-document checks;
  `requireHumanAttachment` awaits `respond`; and the `browser.ts` ↔
  `browserScreenshot.ts` **circular dependency** (a `lint:deps` error that was
  failing `check:all`) removed by extracting a shared `browserReadClass.ts`.
  `pnpm check:all` now green. **Deferred (noted):** native-capture integration
  tests (#6, live E2E); the pre-existing `handleBrowserAct` / sidecar-dispatcher
  size (#9/#10). **Must fix inside Phase 2's act-by-`ref` work:** the injected
  ref resolver is unused until then (#7), and the ref store is document-scoped
  not generation-scoped — a same-document (SPA) navigation retains refs, so
  P2.2/P2.3 MUST bind the mint generation or reset the store (#11, Codex:
  "becomes security-relevant before act-by-ref is enabled").
