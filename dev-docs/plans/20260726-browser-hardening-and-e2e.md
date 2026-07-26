# Browser hardening + E2E verification

**Status: Phases 0–3 + 6 COMPLETE (gates green). Phases 4–5 PARTIAL — 2 of 14 journeys
landed, both verified falsifiable; see `dev-docs/e2e-browser-matrix.md` for the honest
per-invariant status and the one unresolved blocker.**
**Reviewed by Codex 2026-07-26 (thread `019f9d66-1194-7d13-994d-78a8bbd533ee`); corrections applied.**
**WI linkage (rule 60 §2):** `bash scripts/check-wi-linkage.sh dev-docs/plans/20260726-browser-hardening-and-e2e.md`.
WI-0.5 (macOS-only disclosure in the MCP tool description) and WI-6.3 (the
local-gate decision) were implemented but initially shipped unlinked — a self-audit
caught it; both are now carried in test headers.
**Gates:** `bash scripts/check-browser-e2e-phase.sh <0..6>` (named to avoid colliding
with `check-browser-phase.sh`, which gates the earlier 20260712 plan).
**Scope:** the embedded browser (`src-tauri/src/browser/**`, `src/components/Browser/**`,
`src/hooks/mcpBridge/v2/browser*.ts`, `vmark-mcp-server/src/tools/browser.ts`).
**Origin:** the 2026-07-26 investigation.

> **Review history.** Two claims in the first draft were wrong and are corrected below:
> ADR-BR2 assumed a held-open approval request (self-caught), and the problem statement
> mis-measured test coverage and mis-read the Tier-0 matrix's scope (Codex-caught).
> Both errors pointed the same way — they made the work look bigger and the codebase
> look worse than it is.

---

## 1. Problem statement

The browser's *policy core* is the strongest code in the repo: one authoritative gate
(`authorize_driver_op`), generation-bound TOCTOU closure, atomic one-shot consumption,
payload-hash binding, a closed operation vocabulary, and an SSRF validator that handles
legacy IPv4 spellings. Its components — `authorize`, `one_shot`, `operation`,
`origin_guard`, `registry` — are extensively tested. None of that is in question.

Three things around it are:

1. **Docs describe a product that no longer exists.** Cookie capture (`d738b536`) and
   named persistent profiles (`a89ab922`) shipped 2026-07-16. Neither commit touched
   `website/guide/browser.md` or `vmark-mcp-server/src/tools/browser.ts`, so three sites
   still claim the features are unimplemented and a fourth states a false persistence
   limitation. The MCP tool description is the **AI's only contract** — it currently
   tells the AI a working feature does not work.
2. **The command layer above the tested gate has no tests.** `commands_auth.rs`
   (267 lines: `browser_eval`, `browser_screenshot`, `browser_add_one_shot`,
   `browser_ai_attach`, `browser_set_grants`, `browser_add_profile_open`,
   `browser_forget_profile`) has no test module. Its comments cite three `(Audit, High)`
   fixes. The *policy* is covered; the *composition* — mint-then-consume, target
   parsing, post-capture freshness — is not.
3. **Nothing is verified end-to-end.** Zero of 21 journeys touch the browser. ~2,326
   lines of browser code (including the whole macOS native surface: nav registry, KVO,
   screenshot, view lifecycle) have no test module, and no E2E has ever run against any
   of it. The "E2E gate" is a prose checklist with no recorded evidence.

**On the Tier-0 matrix.** The first draft called its lack of browser rows a gap. That
was a misreading: the matrix is explicitly scoped to *unrecoverable document
corruption* and states that AI surfaces belong to a **separate lane** — one that is
declared at `e2e-tier0-matrix.md:127` and is **empty**. Browser rows do not belong in
Tier-0. The real gap is that the declared AI lane was never built.

---

## 2. Architecture decisions

### ADR-BR1 — AI-browser E2E drives the **real sidecar over MCP stdio**

`AGENTS.md` mandates AI-driven features be tested through VMark MCP "exclusively — that
is the surface that ships". The existing harness (`e2e/lib/bridge.mjs`) speaks only the
Tauri bridge on 9323.

| Option | Tests | Rejected because |
|---|---|---|
| A. Raw WebSocket client to VMark's bridge | app-side handlers | Bypasses MCP initialize, tool-schema discovery, `tools/browser.ts` argument validation, and error transformation — all of which ship. |
| B. **Spawn the sidecar, speak MCP stdio** | sidecar + bridge + app | — |

**Decision: B**, with these implementation constraints (all from review):

- Use the MCP SDK's `Client` + `StdioClientTransport`. Do **not** hand-roll JSON-RPC.
  The framing is newline-delimited JSON, not `Content-Length`.
- Perform `initialize` + `notifications/initialized` before any `tools/call`.
- **Rebuild `dist` from the working tree every run.** Checking that `dist/cli.js`
  exists is not enough — the current one is dated July 19 and would silently test stale
  code. This is the single easiest way for this whole plan to prove nothing.
- Capture stderr separately; stdout is protocol-only.
- Poll for real bridge readiness before the first journey. `cli.ts` attempts the
  WebSocket connection *before* starting MCP stdio, so a stale-but-present port file can
  delay initialization by the full 10s connection timeout.
- Close stdin and reap the child in teardown.

**Honest scope limit:** `node dist/cli.js` exercises real sidecar logic but not the
`pkg`-built binary. This is not the literal "full shipping path" unless one smoke also
runs the packaged sidecar. Do not claim otherwise.

Timeout budget (verified, coherent): sidecar bridge request 25s
(`websocket.ts:64`) > MCP SDK client default 60s outer > browser wait input max 12s;
native main-thread cap 20s.

### ADR-BR2 — Approval journeys are **sequential**, not a held-open request

*(Corrected during drafting.)* `browserAct.ts:101-112` does **not** block. On
`needs-approval` it queues a prompt (`requestApproval` returns `void`) and immediately
responds. Approval later mints a one-shot via `grantSync.ts:106 →
browser_add_one_shot`; the **retry** consumes it. Four sequential steps, no concurrency.
The 25s bridge timeout is therefore irrelevant to approvals.

**Two consequences the first draft missed:**

- **The MCP boundary discards structured data.** `toErrorResult`
  (`tools/browser.ts:30`) renders the refusal as *text*, and `mcpAdapters.ts:171`
  returns only `content` + `isError`. A journey cannot assert `data.needsApproval`
  through MCP. It asserts the error text — and the **only** real proof that authority
  was minted is a **successful retry**.
- **"Assert `browser_add_one_shot` was minted" is not a valid oracle.** Reading the
  frontend store proves the frontend intended to mint. `grantSync.ts:106` fires
  `void invoke(...)` and swallows failure into a warning, so Rust may never have
  received it. Only the retry proves it.

### ADR-BR3 — Local fixture HTTP server; no public network

Journeys serve pages from `127.0.0.1`. Determinism, offline capability, and SSRF
assertions need destinations we control.

Fixtures must carry **oracles, not just pages**: per-endpoint request counters, distinct
DOM/server markers per action (click, back, forward, reload, stop), a slow endpoint, a
redirect endpoint, a private-IP redirect target, and clear-and-prove-absent endpoints
for cookies/localStorage.

### ADR-BR4 — Documentation is reconciled first (ordering, not a technical gate)

Phase 0 is first because it is ~20 minutes and fixes a live falsehood in the AI's
contract. The first draft called it a *gate* on later phases; on review that is
ceremony — prose edits do not technically unblock tests. It is ordered first on value,
not dependency.

---

## 3. Phases

### Phase 0 — Reconcile docs + build the phase checker

| WI | Change |
|---|---|
| WI-0.1 | `tools/browser.ts:73` — drop "cookie capture is not yet implemented"; state what is captured (localStorage + domain-scoped cookies). |
| WI-0.2 | `website/guide/browser.md:66` — delete the stale "remaining pieces" warning; it contradicts line 50 of the same file. |
| WI-0.3 | `session_commands.rs:15` — module doc still calls cookie capture "the remaining NATIVE piece". |
| WI-0.4 | `limitations.md:12` — "Restarting VMark does not restore AI cookies" is true for unnamed sandbox tabs, false for named profiles on macOS 14+. Split the claim. |
| WI-0.5 | Add **macOS-only** to the MCP tool description. Today a Windows user's AI gets an opaque `UNSUPPORTED_PLATFORM` with nothing in its contract explaining it. |
| WI-0.6 | Create `scripts/check-browser-e2e-phase.sh` (templated from `check-gha-phase.sh`). **Moved here from Phase 6** — every earlier phase's DoD invokes it. |

**DoD:** `bash scripts/check-browser-e2e-phase.sh 0` exits 0 — asserts each stale phrase is
absent *and* the corrected positive claim is present (so deleting the warning without
stating the real scope also fails).

**Failure modes:**
- *Over-claiming.* Cookies persist on macOS 14+ **with a named profile**; an unnamed
  sandbox tab still uses a non-persistent store. "Logins persist" flatly is a new
  falsehood. WI-0.4 splits it explicitly.

---

### Phase 1 — Regression net for the command layer

| WI | Change |
|---|---|
| WI-1.1 | Half-specified target `(Some(role), None)` is **refused**, not treated as target-less. |
| WI-1.2 | `browser_add_one_shot` refuses: stale approved-generation, unknown operation, unenforceable origin pattern, missing `eval_script` for payload-binding ops. |
| WI-1.3 | `browser_ai_attach` refuses `TAB_NOT_HUMAN` and `STALE_NAVIGATION`. |
| WI-1.4 | `browser_screenshot` discards a capture whose generation went stale mid-capture. |
| WI-1.5 | **Composition, not hashing.** Mint a one-shot for script A, attempt script B at command level, assert refusal. (A bare `script_hash(A) != script_hash(B)` test proves only that SHA-256 works.) |
| WI-1.6 | `browser_set_grants` validates patterns via `is_origin_pattern` and bounds the vector — parity with `browser_add_one_shot`. Today a malformed grant is stored as inert authority that silently never matches. |
| WI-1.7 | `blocked_hostname`: add `*.internal`, `.local`, `home.arpa`. **Not** gated behind `allow_loopback` — see failure modes. |
| WI-1.8 | **Stale-generation gate at the Rust level** (moved here from Phase 5, where it was unreachable — see WI-5.4). An `eval` authorized at generation N is refused at N+1. |
| WI-1.9 | Non-macOS: the stub returns `UNSUPPORTED_PLATFORM`. A unit assertion, so a green macOS suite never implies Windows coverage. |

**DoD:** `cargo test --manifest-path src-tauri/Cargo.toml browser::` passes (there is no
root Cargo workspace); `commands_auth.rs` has a test module;
`bash scripts/check-browser-e2e-phase.sh 1` asserts both.

**Failure modes:**
- *Needing a Tauri harness that does not exist on Windows.* `tauri::test` is cfg-gated
  off Windows (`Cargo.toml:104`). Test pure logic; where a `#[tauri::command]` body is
  unreachable without a harness, extract the decision into a free function — exactly as
  `authorize.rs` was extracted from `commands_auth.rs` for this reason.
- *WI-1.7 mis-scoped.* The first draft proposed gating the new names behind
  `allow_loopback`. That is wrong: `.local` (mDNS) and `home.arpa` resolve to **LAN
  peers**, not loopback. Folding them into a loopback opt-in silently widens that
  toggle from "my own machine" to "my whole network". They need either an unconditional
  block or their own setting. Recommend unconditional for AI tabs (the human browser is
  unaffected — it uses a different validator).

---

### Phase 2 — Fix the `browser_eval` residual race

`commands_auth.rs:188` documents a window between the freshness re-check and the
main-thread dispatch, and says the fix "needs the registry threaded in — tracked as a
follow-up". **It is tracked nowhere.**

**Decision: fix it.** An eval can mutate the DOM or trigger navigation; an irreversible
side effect makes a narrow race still a real authorization race.

| WI | Change |
|---|---|
| WI-2.1 | Replace `surface::eval(app, tab, script)` with a variant taking the expected tab + generation. |
| WI-2.2 | Inside the main-thread closure: resolve `BrowserSurface` from `AppHandle`; re-check enabled policy, generation, committed URL, lifecycle, policy epoch; **drop all guards**; then obtain the webview and call `callAsyncJavaScript`. |
| WI-2.3 | Delete "tracked as a follow-up" from the comment. |

**DoD:** the phrase is gone from `browser/**`; a test proves an eval authorized at
generation N is refused when the closure observes N+1.

**Failure modes:**
- *The first draft's mitigation was wrong.* It said "pass a snapshot, not the `Mutex`".
  A snapshot is what already exists — it cannot detect a change *after* it was taken.
  The check must re-read live state inside the closure.
- *Lock inversion.* Holding the registry lock across `eval_js` **would** deadlock:
  WebKit callbacks run reentrantly on the main thread and themselves take the registry
  lock. Review found no current path holding the registry while waiting on the main
  thread, so acquire-check-drop before dispatch is viable. **Rule: no lock may be held
  across run-loop pumping.** Make that explicit in the module doc.

---

### Phase 3 — E2E harness capability

| WI | Change |
|---|---|
| WI-3.0 | **Runner: `platforms` field.** A `coverageRequired` journey that skips fails the suite — correct for a broken precondition, wrong for a macOS-only feature on Linux. Prerequisite for every browser journey. |
| WI-3.1 | `e2e/lib/fixtureServer.mjs` — pages **plus oracles** (ADR-BR3). |
| WI-3.2 | `e2e/lib/vmarkMcp.mjs` — MCP SDK client over stdio, per ADR-BR1's constraints (fresh build, handshake, readiness poll, stderr capture, child cleanup). |
| WI-3.3 | `e2e/lib/browserApproval.mjs` — drive `BrowserApprovalDialog` by **clicking real DOM** (allow / allow-once / deny). |
| WI-3.4 | `e2e/lib/browser.mjs` — full state save/restore: `enabled`, AI posture, `allowLoopback`, grants, pending approvals, open tabs, named profiles. |

**DoD:** `bash scripts/check-browser-e2e-phase.sh 3` — the five modules exist, the sidecar
rebuild step is wired, and WI-3.0's `platforms` field is honoured by the runner. *(The
first draft's DoD depended on Phase 5 imports, so it could not gate Phase 3.)*

**Failure modes:**
- *Approving through the store instead of the UI.* Calling `resolveApproval` via
  `execute_js` is far easier than clicking the dialog — and would pass while proving the
  dialog is wired to nothing. WI-3.3 must drive the DOM.
- *Teardown that restores less than it mutated.* Grants, posture, and profiles all
  persist within a session; a journey that leaves them set poisons the next one.

---

### Phase 4 — Browser **UI** E2E (Tauri bridge)

Non-AI surfaces, so the existing harness suffices. Every oracle below was strengthened
on review — the originals could pass with the feature broken.

| WI | Journey | Oracle (not just the action) |
|---|---|---|
| WI-4.1 | `22-browser-tab-lifecycle` | Not "the DOM tab is gone" — that proves nothing about the native view. Probe after close and require the webview to be **absent** from the native map. |
| WI-4.2 | `23-browser-omnibox-navigation` | Not omnibox text (it can reflect optimistic store state). Use a **redirect** fixture; assert the final *committed* URL and fixture content. |
| WI-4.3 | `24-browser-chrome-controls` | Not button enablement (store flags). Back/forward/reload each produce a **distinct fixture marker**; stop **prevents** a slow endpoint's terminal marker. |
| WI-4.4 | `25-browser-occlusion` | Not "`browser_freeze` was invoked". Pixel-check a native screenshot — or do **not** mark visual occlusion automated. |
| WI-4.5 | `26-browser-approval-dialog-ui` | Renders operation + origin legibly; Escape denies; Deny is initially focused. **Focus trap removed from scope** — see failure modes. |

**DoD:** five journeys pass; rows land in the **new** `dev-docs/e2e-browser-matrix.md`
(WI-6.1), not in Tier-0.

**Failure modes:**
- *WI-4.5 asserted behaviour that does not exist.* `BrowserApprovalDialog.tsx:78`
  focuses Deny and handles Escape; there is **no focus trap**. Testing for one would
  fail against correct current code. Either drop the assertion (chosen) or add a
  production WI to implement it — do not smuggle a feature request into a test.
- *WI-4.4 becoming an assertion that cannot fail.* If pixel-checking proves unreliable,
  say the visual result is unverified rather than substituting a state check.

---

### Phase 5 — Browser **automation** E2E (via the sidecar)

| WI | Journey | Oracle |
|---|---|---|
| WI-5.1 | `27-browser-disabled-refuses` | Every action returns `BROWSER_DISABLED` **with valid arguments**, so validation cannot mask the feature gate; and no native view is created (compare native identity before/after). |
| WI-5.2 | `28-browser-open-read-act` | Not `clicked:true` — that means `.click()` returned. Assert a **server hit counter** or a subsequent page-state marker. |
| WI-5.3 | `29-browser-ssrf-policy` | Exact `SSRF_BLOCKED` per case (loopback, private-LAN, metadata, `2130706433`, `127.1`, userinfo, `file:`/`data:`), exact redirect-policy error, **zero request counters** where observable, and a **positive control** proving the path works when policy permits. |
| WI-5.4 | *removed* | The MCP `act` never accepts a generation — it resolves the current one internally (`browserAct.ts:174`), so this could only ever test stale **refs**, not the Rust generation gate. Moved to **WI-1.8** where it is reachable. |
| WI-5.5 | `30-browser-session-roundtrip` | Not navigate-away-and-back — cookies/localStorage survive in the same store, so a **no-op load passes**. Explicitly clear both, prove absent, load, prove restored. Plus cross-origin load refused (`STORAGE_STATE_ORIGIN_MISMATCH`). |
| WI-5.6 | *moved to Phase 4* | `browser_assert_no_bridge` is a **Tauri command**, not an action in the MCP tool enum (`tools/browser.ts:79`). It cannot be driven through the sidecar. Becomes `31-browser-no-bridge` on the Tauri lane. |
| WI-5.7 | `32-browser-approval-deny` | Deny → the action does **not** land (assert the fixture oracle, not the error). |
| WI-5.8 | `33-browser-approval-allow-once` | Allow-once → first retry lands; **second** retry needs approval again. |
| WI-5.9 | `34-browser-one-shot-scoping` | A one-shot minted for role/name A **cannot** be spent on B; a standing grant is scoped to operation *and* origin. |
| WI-5.10 | `35-browser-approval-invalidation` | Navigation removes the pending prompt and invalidates unused authority. |

**DoD:** nine journeys pass (5.1–5.3, 5.5, 5.7–5.10 + the relocated no-bridge on the
Tauri lane); rows in `e2e-browser-matrix.md`; `pnpm e2e:journeys` green on macOS.

**Failure modes:**
- *Refusal for the wrong reason.* A fixture-server outage looks like a policy block.
  Hence the positive control in WI-5.3 — non-negotiable.
- *Flaky ARIA snapshots.* Fixture pages: static, no timers, no web fonts.

---

### Phase 6 — Wire the gate

| WI | Change |
|---|---|
| WI-6.1 | Create `dev-docs/e2e-browser-matrix.md` — UI, native security, and MCP automation invariants. **Do not add browser rows to `e2e-tier0-matrix.md`**, whose contract is document-corruption only and which already declares AI surfaces a separate lane (line 127). This plan builds that lane. |
| WI-6.2 | Mark automated rows in `e2e-checklist.md`; list the still-manual ones **as still manual** rather than implying coverage. |
| WI-6.3 | **Decide: local pre-release gate.** E2E needs a headed app and a human-launched `pnpm tauri:dev` (SIP). Absent a headed self-hosted runner, CI cannot run it. Record it as a release-checklist step, not an aspirational CI job. |
| WI-6.4 | DEFERRED — automate the remaining high-value manual rows (sandbox/human store isolation, ticket supersession + buffering, disabling an already-running browser, human-attachment expiry). **Every one needs a human browser tab**, which the harness cannot create (see the matrix's UI-lane diagnosis), so this is blocked on the same gap as Phase 4, not merely unstarted. |

---

## 4. Cross-cutting failure modes

| Risk | Why it bites | Mitigation |
|---|---|---|
| **E2E that cannot fail** | The largest risk here. A journey passing because it asserted nothing reachable converts an unknown into a false *known*. Review found this in **9 of 11** originally-proposed journeys. | Every journey must be **seen to fail once**: break the invariant, watch it go red, restore, record it in the header (journey 17's discipline). |
| **Stale sidecar `dist`** | Silently tests July-19 code and passes. | Rebuild from the tree every run (ADR-BR1). |
| **Planning on an unverified mental model** | ADR-BR2's first draft asserted a held-open request; reading `browserAct.ts:101` removed the plan's supposed biggest risk. | Any claim about a *mechanism* must cite the file:line establishing it before a phase is ordered around it. |
| **Measuring by proxy** | "2,626 lines untested" counted `mod tests` and missed `#[path = "*.test.rs"]` includes; "the commit touched one file" came from reading absence out of grep-filtered output. Both overstated the problem. | Count with the actual include forms; never conclude from filtered evidence. |
| **macOS-only coverage read as universal** | A green macOS suite says nothing about the Windows stub. | WI-1.9 asserts the stub as a unit test; WI-3.0 makes platform skips honest. |
| **Scope creep into WebView2** | The real reach limit is Windows; tempting to fold in. | Explicitly out of scope. This plan hardens and verifies what exists. |

---

## 5. Effort

AI-execution time; compute-time and clock-time separated.

| Phase | Nature | Compute | Clock |
|---|---|---|---|
| 0 | Mechanical (docs + script) | ~40 min | — |
| 1 | Mostly mechanical; WI-1.7 needs judgment | ~3 h | — |
| 2 | **Irreducible** — threading/lock-ordering | ~1 h think, ~1.5 h implement | — |
| 3 | Novel harness work | ~3 h | needs running debug app |
| 4 | Mechanical once WI-3.0 lands | ~4 h | needs running debug app |
| 5 | Mechanical once Phase 3 lands | ~6 h | needs running debug app |
| 6 | Mechanical + one decision | ~1 h | — |

**Phases 0–2: ~6 h, no external dependency.** Phases 3–6: ~14 h, all gated on a
human-launched headed app.

---

## 6. Open questions

1. **WI-1.7 scope** — unconditional block for `.local`/`home.arpa` on AI tabs, or a new
   opt-in setting? Recommend unconditional; a setting nobody finds is not a feature.
2. **Phase 4 before Phase 3?** Phase 4 needs only the existing Tauri bridge and WI-3.0.
   Shipping it first puts visible browser coverage in place days earlier.
3. **Is the packaged-sidecar smoke worth it** (ADR-BR1's honest scope limit), or is
   `node dist/cli.js` sufficient?
