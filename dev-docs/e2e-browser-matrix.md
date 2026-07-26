# E2E Browser Matrix — invariants × journeys

**Scope:** the embedded browser. This is the lane
`dev-docs/e2e-tier0-matrix.md:127` declares and does not contain: that matrix is
scoped to *unrecoverable document corruption* and explicitly excludes AI surfaces.
Browser rows belong here, not there.

**Plan:** `dev-docs/plans/20260726-browser-hardening-and-e2e.md`.

## Two lanes, two bridges

Per `AGENTS.md`, the bridge is decided by what is being tested, not by convenience:

| Lane | Bridge | Covers |
|---|---|---|
| **UI / plumbing** | Tauri MCP (`ws://127.0.0.1:9323`, debug-only) | tab lifecycle, omnibox, chrome controls, occlusion, the approval dialog as a *widget* |
| **AI automation** | VMark MCP, via the **real sidecar** over stdio (ADR-BR1) | `browser.read/act/open/navigate/...`, the feature gate, SSRF policy, approvals end-to-end |

An AI-surface invariant tested through the Tauri harness would exercise a path no
user takes, so it does not count as coverage of that invariant.

## WI-6.3 — this is a **local pre-release gate, not a CI gate**

E2E needs a headed debug app (`pnpm tauri:dev`) that macOS SIP prevents the harness
from launching, and no workflow references `e2e`. Wiring a headed self-hosted runner
is out of scope for this plan. **Consequence: these journeys protect nothing between
releases unless someone runs them.** Run `pnpm e2e:journeys` before cutting a release.
This is recorded as a decision so it does not resolve by default a second time — the
`browser_eval` race became an orphan exactly that way.

## Status legend

`✅ automated` — a journey asserts it AND the journey has been *seen to fail* when the
invariant is broken. `🟡 partial` — asserted, weaker oracle than desired.
`⬜ not automated` — still manual (`dev-docs/grills/ai-browser/e2e-checklist.md`).

## AI automation lane (VMark MCP via sidecar)

| # | Invariant | Failure mode if it breaks | Journey | Status |
|---|---|---|---|---|
| B1 | Every action refuses with `BROWSER_DISABLED` while the feature is off, and creates no native view | An opt-in AI surface drives pages for a user who never enabled it | `browser-disabled-refuses` | ✅ automated |
| B2 | `open` → `read` returns an ARIA snapshot naming real elements | The AI acts on a page it cannot actually see | `browser-open-read-act` | ✅ automated |
| B3 | `act` click reaches the page (server-side hit counter, not `clicked:true`) | Actions silently no-op; the AI believes it acted | `browser-open-read-act` | ✅ automated |
| B4 | SSRF: loopback, private-LAN, metadata, alternate IPv4, userinfo, `file:`/`data:` each refused **before** a request, with a positive control | The AI reaches internal infrastructure | `browser-ssrf-policy` (16 destinations) | ✅ automated |
| B5 | A redirect into private space is refused at the redirect hop | Policy checks only the first URL | `browser-redirect-ssrf` | ✅ automated |
| B6 | Session save/load round-trips **after proving the values absent**, and refuses cross-origin | A no-op restore passes; or credentials land under the wrong origin | — | ⬜ not automated |
| B7 | Approve → retry succeeds (dialog clicked, not injected) | The human half of the security model is decorative | `browser-open-read-act` | 🟡 partial — the **deny** half is not yet asserted |
| B8 | Allow-once is spent by the first retry; a second needs fresh approval | One approval becomes standing authority | `browser-approval-scoping` | ✅ automated |
| B9 | A one-shot for element A cannot be spent on element B | Approval for a benign control authorizes a dangerous one | `browser-approval-scoping` | ✅ automated |
| B10 | Navigation invalidates a pending prompt and unused authority | An approval follows the user to a page they never saw | `browser-approval-invalidation` | ✅ automated |

## UI lane (Tauri MCP)

| # | Invariant | Failure mode if it breaks | Journey | Status |
|---|---|---|---|---|
| B11 | Closing a browser tab tears down the **native** view | `WKWebView` leak; a live page keeps running invisibly | `browser-tab-lifecycle` | ✅ automated |
| B12 | The omnibox shows the **committed** URL after a redirect, not the typed one | The user is told they are somewhere they are not | `browser-tab-lifecycle` | ✅ automated |
| B13 | Back / forward / reload each produce a distinct observable effect | Chrome controls look enabled and do nothing | `browser-chrome-controls` | 🟡 partial — `stop` not asserted |
| B14 | A DOM overlay actually occludes the native view (freeze/thaw) | Page content paints over app UI — the bug the occlusion service exists for | — | ⬜ not automated |
| B15 | The approval dialog renders operation + origin, focuses Deny, and Escape denies | The user approves something they cannot read | — | ⬜ not automated |
| B16 | `browser_assert_no_bridge` returns all-false on a live page | Tauri IPC leaked into a browsed page — any site gets a channel into the app | `browser-no-bridge` | ✅ automated |

> B16 is a **Tauri-lane** row deliberately: `browser_assert_no_bridge` is a Tauri
> command, not an action in the MCP `browser` tool's enum, so it cannot be driven
> through the sidecar at all.

## Honest status

**11 automated + 2 partial, of 16 rows.** Every green row was watched failing:

- `browser-disabled-refuses` (B1) — enabling the feature makes it red.
- `browser-open-read-act` (B2/B3/B7) — skipping the approval click makes it red
  ("click still refused after approval"), proving the dialog is load-bearing and
  not decorative.
- `browser-ssrf-policy` (B4) — 16 destinations, with a **positive control** that
  runs first so a clean sweep of refusals can never be environmental. Flipping the
  loopback opt-in on makes it red, proving the assertions track policy state rather
  than merely observing failure.

The second exercises the whole stack in one pass: sidecar MCP → WebSocket bridge →
app → Rust authorization gate → `WKWebView` → the page → back out to the fixture
server's request counter. It also confirms ADR-BR2 in practice — the approval really
is sequential (refuse, approve, retry), not a held-open request.

Later additions, each with the same discipline:

- `browser-no-bridge` (B16) — the R3/SPIKE-1 privacy claim, which had **never run**.
  It was resting on a spike report and a code comment. Runs in the PAGE world,
  since the isolated world would report "clean" regardless.
- `browser-approval-scoping` (B8/B9) — an approval for one element cannot be spent
  on another, a refused action does not burn the approval, and allow-once really is
  once. The substituted target is a REAL element on the fixture, or the refusal
  would be "no such node" rather than a scoping decision.
- `browser-redirect-ssrf` (B5) — the first version passed on `NAVIGATION_SUPERSEDED`,
  a ticket race rather than a policy decision. It now asserts the committed URL
  unconditionally, so an error alone can no longer stand in for a block.

### The UI lane — was blocked, now open (WI-4.0)

Every UI row needs a *human* browser tab. Four independent routes to creating one
all failed, which established this as a **harness capability gap, not a browser
bug**:

| Route | Result |
|---|---|
| `window.__TAURI__.event.emit('menu:new-browser-tab')` from the webview | no tab — and the **control** (`menu:new-tab`, not browser-gated) also does nothing, so the webview→`listen()` loopback is what is broken, not the browser gate |
| `emit_event` over the debug bridge | `Unknown command` — this plugin build exposes only `list_windows`, `execute_js`, `capture_native_screenshot` |
| `ipc_emit_event` via the Tauri MCP server | reports "emitted successfully", tab count unchanged |
| Synthetic `Mod+Shift+P` to open the command palette | palette never opens; synthetic key events do not reach the keybinding layer |

The control experiment is the important one: a **non-browser** menu event fails
identically, which rules out the browser feature gate as the cause.

**Resolved by the third option: a DEV-only seam** (`src/utils/devDebugHandle.ts`).
The app publishes `executeCommand` on `window.__VMARK_DEBUG__` in DEV builds only,
and the harness calls `browser.newTab` through it. That is the *same* function the
native menu route calls (`menuListener.ts`), so a journey travels the real dispatch
path rather than a test-only shortcut past it. It is `import.meta.env.DEV`-gated, so
it is dropped from production rather than merely unused — shipping it would let any
script in the app webview run arbitrary commands.

One bug found while adding it: the pre-existing `__VMARK_DEBUG__` publisher assigned
the whole object, so a second publisher would have silently erased `editorView` on
the next editor change — an intermittent failure that would have read as harness
flake. Publication now merges.

B13 and B16 followed on this seam. `browser-chrome-controls` asserts back /
forward / reload against the COMMITTED url and, for reload, a server-side re-fetch
— not button enablement, which is a store flag a dead chrome would also flip.

Do **not** mark a row ✅ before its journey has been watched failing.

## Growing this matrix

1. Add the invariant here first, with its failure mode.
2. Write the journey; give it a real oracle — a server-side counter or a distinct
   page marker, never the action's own report of itself.
3. Break the invariant deliberately, watch the journey go red, restore, and record
   that in the journey header (journey 17 is the template).
4. Only then set ✅ and `coverageRequired: true`.
5. macOS-only journeys must declare `platforms: ["darwin"]` so other platforms
   report `n/a` rather than lost coverage.
