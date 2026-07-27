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

## The gates are themselves tested

`bash scripts/check-browser-e2e-phase.selftest.sh` mutates real production code —
deleting `lan_facing_suffix`, disabling grant validation, removing the in-dispatch
freshness check — and requires the gate to go **red** for each. An assertion that
survives its own mutation is reported `BLIND`, not as a pass.

This exists because the "seen to fail" standard was applied to journeys and never
to the gates, which are mostly shell greps. Three gate bugs had already shipped:

| Bug | How it passed while the work was undone |
|---|---|
| Phase 2 generation parameter | Grepped `surface.rs`, which held only the non-macOS **stub** — a stub-only signature would have passed with the real macOS `eval` unguarded. Found by accident when a file split moved the stub. |
| Phase 1 LAN suffixes | Grepped for `local` and `internal`. `localhost` contains one, `metadata.google.internal` the other — deleting the whole function left 2 of 3 assertions green. |
| Phase 6 CI decision | An **alternation** (`A|B`): deleting half the claim left the other half matching. |

Phases 1 and 2 now run **named tests** instead of grepping, and `run_test` fails
when a test does not execute at all — `cargo test <name>` exits 0 when nothing
matches, so a renamed or deleted test would otherwise read as success.

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
| B6 | Session save/load round-trips **after proving the values absent**, and refuses cross-origin | A no-op restore passes; or credentials land under the wrong origin | `browser-session-roundtrip` | ✅ automated — localStorage **and** cookies verified restored via a read-only endpoint, and a cross-origin load refused **even with approval** |
| B7 | Approve → retry succeeds; **deny** → the action does not land | The human half of the security model is decorative | `browser-open-read-act`, `browser-approval-scoping` | ✅ automated |
| B8 | Allow-once is spent by the first retry; a second needs fresh approval | One approval becomes standing authority | `browser-approval-scoping` | ✅ automated |
| B9 | A one-shot for element A cannot be spent on element B | Approval for a benign control authorizes a dangerous one | `browser-approval-scoping` | ✅ automated |
| B10 | Navigation invalidates a pending prompt and unused authority | An approval follows the user to a page they never saw | `browser-approval-invalidation` | ✅ automated |

## UI lane (Tauri MCP)

| # | Invariant | Failure mode if it breaks | Journey | Status |
|---|---|---|---|---|
| B11 | Closing a browser tab tears down the **native** view | `WKWebView` leak; a live page keeps running invisibly | `browser-tab-lifecycle` | ✅ automated — asserts the app's own **native webview map** (`browser_debug_native_tab_ids`), not a DOM proxy |
| B12 | The omnibox shows the **committed** URL after a redirect, not the typed one | The user is told they are somewhere they are not | `browser-tab-lifecycle` | ✅ automated |
| B13 | Back / forward / reload each produce a distinct observable effect | Chrome controls look enabled and do nothing | `browser-chrome-controls` | 🟡 partial — `stop` not asserted |
| B14 | A DOM overlay actually occludes the native view (freeze/thaw) | Page content paints over app UI — the bug the occlusion service exists for | `browser-occlusion` | ✅ automated — a **real overlay** (breakdown panel, via `useBrowserOccluder`) drives it, asserted with an AppKit `hitTest:` oracle across three states |
| B15 | The approval dialog renders operation + origin, focuses Deny, and Escape denies | The user approves something they cannot read | — | ⬜ not automated |
| B16 | `browser_assert_no_bridge` returns all-false on a live page | Tauri IPC leaked into a browsed page — any site gets a channel into the app | `browser-no-bridge` | ✅ automated |

> B16 is a **Tauri-lane** row deliberately: `browser_assert_no_bridge` is a Tauri
> command, not an action in the MCP `browser` tool's enum, so it cannot be driven
> through the sidecar at all.

## Honest status

**14 automated, 1 partial, 1 manual — of 16 rows.** (An earlier revision claimed "16 automated of 16", which is arithmetically impossible alongside a partial and a manual row; an audit caught it after the wrong figure had already been reported.) Every green row was watched failing:

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

### Capabilities built to close audit findings

Three findings could not be fixed by editing a test; they needed capability that
did not exist. All three now do:

| Capability | What it unblocked |
|---|---|
| `browser_debug_native_tab_ids` — debug-only Tauri command over the native webview map | B11/B27 asserted a **DOM proxy**, so removing the React surface while leaking the `WKWebView` passed. Falsified: skipping the close now reports the leaked tab id. |
| `authorize::dispatch_if_fresh` — the verify-then-dispatch ordering, extracted from the macOS closure | The WI-2 race fix had **no test**: it lived where a real webview and main thread were required, so deleting it left every test green. Now pure and unit-tested; deleting the check kills **5** tests. |
| Packet oracle + reserved-address destinations in `29-browser-ssrf-policy` | The counter assertion could not fail (it watched a port no blocked URL targeted), and the journey was **unsafe under its own regression** — it would have contacted the user's LAN and put Basic credentials on the wire. The fixture is now itself a blocked loopback destination, so a leaked packet is observable; every other target is RFC 5737 TEST-NET or RFC 3927 link-local. |

### B14 (occlusion) — closed, by changing the question

A pixel oracle was attempted first and is genuinely unreachable. Captured the same
full-bleed magenta page two ways at one instant:

| Capture path | Result |
|---|---|
| VMark's `browser.screenshot` (WebKit `takeSnapshot`) | **pure magenta** — the page renders |
| Debug bridge `capture_native_screenshot` (window) | **blank white** in that region |

The bridge's window capture does not composite the sibling `WKWebView`, and
`takeSnapshot` renders the view directly so it reports content whether or not the
view is composited. Neither observes compositing state.

**The invariant was never really "the pixels are magenta" — it is "does the native
view occlude this point".** AppKit answers that directly: `hitTest:` walks the real
hierarchy in z-order and **skips hidden views**, the same visibility rule the
compositor applies. So `browser_debug_hit_test` (debug builds only) asks which view
is on top, through a path independent of the one `browser_freeze` writes to — which
a `isHidden` read-back would not be, being very nearly a tautology.

The journey asserts three states, because two would pass for a freeze that
DESTROYED the view:

```
thawed  → occluded by NSKVONotifying_WKWebView
frozen  → resolves to WryWebView   (Tauri's own DOM-hosting webview, behind it)
thawed  → occluded by NSKVONotifying_WKWebView
```

That middle line is the invariant in one observation: with the browser frozen, the
point belongs to the DOM layer. Falsified by skipping the freeze.

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
