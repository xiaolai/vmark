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
| B4 | SSRF: loopback, private-LAN, metadata, alternate IPv4, userinfo, `file:`/`data:` each refused **before** a request, with a positive control | The AI reaches internal infrastructure | — | ⬜ not automated |
| B5 | A redirect into private space is refused at the redirect hop | Policy checks only the first URL | — | ⬜ not automated |
| B6 | Session save/load round-trips **after proving the values absent**, and refuses cross-origin | A no-op restore passes; or credentials land under the wrong origin | — | ⬜ not automated |
| B7 | Approve → retry succeeds (dialog clicked, not injected) | The human half of the security model is decorative | `browser-open-read-act` | 🟡 partial — the **deny** half is not yet asserted |
| B8 | Allow-once is spent by the first retry; a second needs fresh approval | One approval becomes standing authority | — | ⬜ not automated |
| B9 | A one-shot for element A cannot be spent on element B | Approval for a benign control authorizes a dangerous one | — | ⬜ not automated |
| B10 | Navigation invalidates a pending prompt and unused authority | An approval follows the user to a page they never saw | — | ⬜ not automated |

## UI lane (Tauri MCP)

| # | Invariant | Failure mode if it breaks | Journey | Status |
|---|---|---|---|---|
| B11 | Closing a browser tab tears down the **native** view | `WKWebView` leak; a live page keeps running invisibly | — | ⬜ not automated |
| B12 | The omnibox shows the **committed** URL after a redirect, not the typed one | The user is told they are somewhere they are not | — | ⬜ not automated |
| B13 | Back / forward / reload / stop each produce a distinct observable effect | Chrome controls look enabled and do nothing | — | ⬜ not automated |
| B14 | A DOM overlay actually occludes the native view (freeze/thaw) | Page content paints over app UI — the bug the occlusion service exists for | — | ⬜ not automated |
| B15 | The approval dialog renders operation + origin, focuses Deny, and Escape denies | The user approves something they cannot read | — | ⬜ not automated |
| B16 | `browser_assert_no_bridge` returns all-false on a live page | Tauri IPC leaked into a browsed page — any site gets a channel into the app | — | ⬜ not automated |

> B16 is a **Tauri-lane** row deliberately: `browser_assert_no_bridge` is a Tauri
> command, not an action in the MCP `browser` tool's enum, so it cannot be driven
> through the sidecar at all.

## Honest status

**3 automated + 1 partial, of 16 rows.** Both journeys were watched failing:

- `browser-disabled-refuses` (B1) — enabling the feature makes it red.
- `browser-open-read-act` (B2/B3/B7) — skipping the approval click makes it red
  ("click still refused after approval"), proving the dialog is load-bearing and
  not decorative.

The second exercises the whole stack in one pass: sidecar MCP → WebSocket bridge →
app → Rust authorization gate → `WKWebView` → the page → back out to the fixture
server's request counter. It also confirms ADR-BR2 in practice — the approval really
is sequential (refuse, approve, retry), not a held-open request.

**The AI-automation lane is unblocked**; B4–B6 and B8–B10 are ordinary work now that
`open`/`read`/`act`/approve are proven from the harness.

**The UI lane (B11–B16) is blocked on one unresolved mechanic:** creating a *human*
browser tab from the harness. Emitting `menu:new-browser-tab` through the webview's
Tauri global produces no tab, even with `browser.enabled` true in both the persisted
settings and the live store (the Rust policy updates through the store subscription,
so the store demonstrably synced). Whether that is a harness limitation or a real
defect in the menu→command route is **not yet determined** — and until it is, those
journeys would rest on an unverified assumption, which is the failure this plan
exists to prevent.

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
