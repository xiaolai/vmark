# Plan: Per-workspace-instance terminal session sets (WI-TS)

**Status:** Phase 0 not started · v3 after refuter-panel round 1 + Codex
cross-model review round 2 (see Review rounds; §6 requirement satisfied)
**Home:** `.claude/tdd-guardian/` (tracked — committed on maintainer direction, 2026-08-31; DoD script lives in `scripts/`)
**WI namespace:** `WI-TS<phase>.<n>` (§1 — bare `WI-N.M` collides across plans)
**Release note:** Phases 1–4 are ONE release train — intermediate mains are
gate-green but a rail user on a mid-train build sees transitional oddities
(unfiltered tab bar until Phase 3). Do not tag a release between Phase 1 and
the end of Phase 4.

## Problem

Terminal sessions are one window-global set (`terminalSlice.ts:35-36`); a rail
switch "follows" only by typing `cd` into every live shell
(`terminalSessionStoreSync.ts:172-193`). Live repro on 2026-08-31 (dev app,
Tauri MCP harness) established:

- Idle shell + rail switch → cd follows within ~1s (works).
- **Busy shell** (`sleep 300`, i.e. any claude/vim/dev-server) + rail switch →
  UI switches, shell stays in the old workspace for the entire life of the
  foreground command, silently (`pendingRoot` deferral,
  `terminalSessionStoreSync.ts:179-182`). This is the reported
  "terminal isn't following" — for AI-tool users the shell is busy ~always.
- Non-integrated shells (fish, all Windows — `shell_integration.rs:98-105`
  returns `None`) have `isShellBusy()` ≡ false, so the switch types
  `Ctrl+U cd '…'\n` INTO the foreground program.
- Even when cd works it mutates the user's shell (clears partial input,
  pollutes history) and shares one session set — scrollback, running
  processes, `VMARK_WORKSPACE` — across every workspace.

**Maintainer decision (2026-08-31): the right fix, not the cheap one** — scope
terminal sessions to their owning `workspaceInstanceId`, the pattern the rail
plan used for pane layouts (D3) and closed-tab scopes (D4). This revises
rail-plan D2's "terminal is window-global" for the session set only; panel
visibility/geometry stay window-global.

## Decision record (settled — do not relitigate during implementation)

| # | Decision | Rationale anchor |
|---|---|---|
| D-T1 | **Ownership is a per-session field, stamped at creation** from `getActiveWorkspaceScope(windowLabel).workspaceInstanceId` — with THREE carve-outs, resolved by ONE shared helper `resolveTerminalOwnerInstanceId(windowLabel)` in `src/services/terminal/`: never stamp a **placeholder** instance's id (placeholders are deleted silently by `addWorkspaceInstance`/`ensureLooseInstance` with no lifecycle follower — `workspaceInstancesStore.ts:51-65`, `:216-227`); never stamp while **`isWindowContextRestoring(windowLabel)`** (a mid-restore auto-create would bind to the pre-reconcile active id — `restoreHelpers.ts:165` fires before reconcile can re-activate); never stamp while the **rail is off**. Field absent ⇒ *window-scoped*. On every rail switch (and on hydrate), window-scoped sessions are **adopted by the outgoing (resp. active) instance**, skipping placeholder targets. | Creation always happens under the active scope (`useTerminalShellLifecycle.ts:122-137`). The carve-outs close the round-1 blocker (placeholder-stranded PTY) and the restore race (stamped-too-early → hidden session + double-create). |
| D-T2 | **Store shape: flat list + owner field + per-scope active memory.** `TerminalSession.workspaceInstanceId?: string` (optional-key pattern of `requestedCwd`, `terminalSlice.ts:113`); new `lastActiveByScope: Record<string, string \| null>`. `activeSessionId` KEEPS its meaning — *the session currently shown* — so all ~10 consumers (fit, search, getActiveTerminal, bell isActive, restart, reveal, Cmd+N) stay semantically correct unmodified. | Verified round 1: every listed consumer is null-safe. |
| D-T3 | **Sessions NEVER leave the store on a switch; scoping lives in selectors + visibility.** The reconcile subscription treats "id left the array" as *dispose xterm + kill PTY* (pre-split `useTerminalSessions.ts:258-273` → the module WI-TS0.2 extracts; → `terminalSessionReconcile.ts:42-45` → `removeSessionEntry`), with no guard on the removed side. Hiding = `switchVisibility`'s existing `display:none` driven by the `activeSessionId` change; hidden entries keep PTY + buffer (`terminalSessionRegistry.ts:54-65`). | Both review rounds confirmed: no other code path removes sessions on workspace changes; `switchVisibility(null)` hides all while preserving PTYs; the panel never unmounts once activated. |
| D-T4 | **cd-follow applies ONLY to effectively-window-scoped sessions, at all THREE sites:** the syncRoot loop (`terminalSessionStoreSync.ts:172`, guard before `:179`), the post-spawn catch-up (`useTerminalShellLifecycle.ts:205-209`), and **`flushPendingRoot` (`terminalSessionStoreSync.ts:65-79`)** — the OSC-133 idle callback is an independent cd path and a `pendingRoot` recorded pre-adoption survives adoption. Owner resolved live from the store by session id. Guards are rail-aware (D-T15). | "Both sites" was refuted by BOTH review rounds independently — the flush is a third site; one guard inside `flushPendingRoot` covers every caller. |
| D-T5 | **Cap and ordinals are per *visible population*; the cap is a CREATION-TIME GATE, not a population invariant.** Creation counts target scope ∪ window-scoped when rail on, all sessions when off; ordinal = smallest unused across the same union (no two visible "Terminal 1"). `terminalAdoptUnscopedSessions` renumbers on in-scope collision (labels untouched) and **never kills** — so a scope can transiently exceed 5 (reachable: sessions created under an active placeholder count no hidden scope, then get adopted later); the `+` stays disabled until the visible count drops below 5. **No window-level ceiling**: creation is one user click at a time behind the gate; a hidden idle session costs one PTY + a few MB of xterm buffer. If field feedback shows runaway populations, add a window ceiling then — measured, not guessed. | Round-1/round-2 convergent refutation of the v1 rule (per-scope smallest-unused breaks visible uniqueness and its own adoption AC). The Codex over-cap sequence is real via the placeholder path and is pinned by test rather than "prevented" by a kill nobody wants. |
| D-T6 | **Instance lifecycle:** close → remove that instance's sessions (the reconcile's dispose-on-remove path is *correct* here), strictly after the re-validate point (`closeWorkspaceInstance.ts:117-122` — never before the dirty-check await); move-to-window → same kill on the source after ack (`workspaceWindowActions.ts:32-46`; the ack-timeout/cancel path kills nothing); duplicate → copies nothing; loose-instance **rekey merges**: re-stamp every oldId session to newId, renumber ordinals on in-scope collision, `lastActiveByScope` target-wins (mirror `workspaceInstanceUiStore.ts:204`), cap unaffected (creation gate). **Close/move of the ACTIVE instance must also realign:** `removeWorkspaceInstance` promotes `ids[0]` (`workspaceInstancesStore/helpers.ts:28-41`) with no switch event, so after removal the caller calls `terminalHydrateScope(successorId)` — otherwise `activeSessionId` stays null over the successor's hidden sessions and auto-create refuses (non-empty scope): a blank panel with live hidden PTYs. | PTY/xterm state cannot cross webviews (payload carries instance identity + tabs only, `workspace_transfer.rs:46-63`). Realign + merge semantics are round-1/round-2 convergent findings. |
| D-T7 | **"Last session" panel-hide is computed on the VISIBLE population** at both sites (`TerminalPanel.tsx:183-189`, `useTerminalShellLifecycle.ts:69-79`). | Panel-hide is about what the user sees; hidden sessions keep running. |
| D-T8 | **Auto-create is scope-aware, gate-checked against the INCOMING SCOPE, and BOTH creators go through ONE shared helper.** `canAutoCreateInScope(scope, activeTabHasSavedFile)` = `scope.isWorkspaceMode \|\| activeTabHasSavedFile`, evaluated on `getActiveWorkspaceScope(...)` (synchronous, instance-backed). `canOpenTerminal()` (`terminalGate.ts:10-22`) reads the LEGACY `useWorkspaceStore`, updated only by the *async* `syncLegacyWorkspaceContext` refresh and **never after a close** — gating on it races the scope it gates. The shared helper `maybeAutoCreateTerminalSession(windowLabel)` is used by the panel effect (re-fires on `[visible, activeInstanceId]`) AND the mount-time creator (pre-split `useTerminalSessions.ts:237-243`) — today the latter creates unconditionally, so a hot-exit-restored-visible panel over a refusing scope would spawn into `$HOME`. Gate refuses → i18n'd empty-state hint. Toggle-time gate (`requestToggleTerminal`) unchanged. | Round-1 showed the legacy gate makes the WI's own tests unimplementable; round-2 caught the second, ungated creator. |
| D-T9 | **A session's spawn env/cwd derive from a pure, named contract:** `resolveTerminalSpawnContext(windowLabel, session)` → `{ cwd, workspaceRoot }` = `requestedCwd` ?? same-scope sibling OSC-7 cwd ?? (owner instance's `rootPath` when stamped and the instance still exists; else active-scope resolution as today). Resolved ONCE pre-await; `spawnPty` takes `workspaceRoot` as a parameter and stops re-resolving post-await (`spawnPty.ts:189`). Missing owner (deleted mid-spawn) falls back to active scope — spawn only ever starts for a visible session, so this is the degenerate case, not the norm. | Kills the mid-spawn race (cwd pre-await vs `VMARK_WORKSPACE` post-await). Round-2 asked for the contract to be named rather than implied; here it is. |
| D-T10 | **Run-in-Terminal / reveal pick from the visible population** (`revealTerminalSession.ts:35-44`). Deferred delivery stays pinned to the session id (`runInTerminal.ts:171-223`) — a command requested in workspace A lands in A's shell even if the user switches away mid-delivery. | Id-pinning is already deliberate; now stated. |
| D-T11 | **Bell/attention stay window-level.** `hasActivity` still sets; OS notification + window attention fire regardless of scope (`terminalAttention.ts:117-134`). **Every action that activates a session — `terminalSetActiveSession`, `terminalSwitchScope`, `terminalHydrateScope` — applies the same `hasActivity` clear** (`terminalSlice.ts:139-155`), so a restored remembered session doesn't carry a stale dot. Rail-item activity badge = named follow-up. | Round-2 caught the switchScope/activity-clear bypass. |
| D-T12 | **No session persistence.** Hot exit keeps capturing exactly `terminal_visible`/`terminal_height` (`_hotExitCapture.ts:48-49`); PTYs die at relaunch (`restartWithHotExit.ts:111`). Restore safety: **the restore guard is released BEFORE hydrate runs** (`_hotExitRestore.ts:83` `finally` precedes the `hydrateWorkspaceInstanceContext` await at `:97` — v2's "runs while declined" claim was FALSE, caught by round 2). The actual safety argument: any user switch landing in the gap performs adoption itself (WI-TS2.2), and hydrate's adopt+`terminalHydrateScope(activeId)` is convergent — it re-aligns to whatever instance is active, so it cannot clobber a user's explicit switch. Pin that idempotence. | Persisting an association whose referent cannot survive is dead weight. |
| D-T13 | **E2E: journey 18 gets an explicit rail-OFF precondition; a new rail journey asserts the scoped contract.** New `e2e/lib/rail.mjs` (settings patch via the `patchBrowserSettings` StorageEvent pattern, `browser.mjs:45-64` — verified to rehydrate `general.*` live; rail clicks via new stable `data-*` attributes — aria-labels are localized). CI list in `tier0-e2e.yml:180-189` is hardcoded and must name the new journey. | Journeys 17/18 silently depend on the runner's rail-off default profile. |
| D-T14 | **`workspaceRailMode` default stays `false`.** | Non-goal; keeps tier-0 CI meaning stable. |
| D-T15 | **Rail OFF makes stamps INERT, never erased.** With `isWorkspaceRailEnabled()` false: the visible selector returns **all** sessions; cap/ordinal count all sessions; cd-follow guards treat **every** session as followable. Stamps stay on the records and reactivate on re-enable. The toggle is involutive; no cleanup, no new lifecycle site. | Both rounds independently flagged the ON→OFF transition as stranding stamped sessions invisibly with live PTYs. Inert-at-query-time is the only repair that preserves invariant 3. |

## Architecture invariants

1. **A store-removal is a PTY kill; a switch is never a store-removal.** Only
   close-session, close-instance, move-out, and window teardown remove ids
   from `terminal.sessions`.
2. **Exactly one session is displayed per window** (`activeSessionId`), always
   a member of the current visible population (or null), and a non-empty
   visible population with a visible panel never renders blank (D-T6 realign
   + D-T8 auto-create together guarantee it).
3. **Owner changes are monotone**: absent → non-placeholder instanceId
   (stamp/adopt) or instanceId → instanceId (rekey). Never instanceId →
   absent; never a placeholder id. **Every stamped owner exists in the
   instances map** — a set-level invariant test over arbitrary lifecycle
   sequences (create/switch/close/move/rekey/placeholder churn).
4. **Rail-off — never-enabled or toggled off mid-session — behaves exactly as
   today for every session** (D-T15 inert stamps). Pinning tests include the
   toggle transition with stamped sessions present, and on→off→on.
5. **Theme/settings sync stays global** — hidden scopes' sessions keep
   receiving font/theme/scrollback updates (`terminalSessionStoreSync.ts:115-129`;
   pinned by `.live`/`.theme` tests), or they come back stale on reveal.
6. **No async in the terminal switch step.** All transition writes are
   synchronous store ops; the generation guard problem
   (`switchWorkspaceInstance.ts:185-194`) cannot arise.
7. **Selector vocabulary has ONE count meaning**: the visible population
   (`selectVisibleTerminalSessions` / `selectVisibleSessionCount`) drives
   visibility, cap, ordinals, last-session, and auto-create alike. Owner-exact
   enumeration exists only inside remove/rekey/adopt actions and is not
   exported as a count.

## Phases and work items

TDD mandatory (RED→GREEN→REFACTOR); store tests via `getState()` +
`beforeEach` reset; file gate < 300 lines. **Two files need pre-splits**
(WI-TS0.2/0.3): `useTerminalSessions.ts` (295/300) and
`workspaceInstancesStore.ts` (**299/300**, unbaselined — a 2-line addition
fails `lint:file-size`). `useTerminalShellLifecycle.ts` (262),
`TerminalPanel.tsx` (261), `terminalSlice.ts` (200) have headroom but split
proactively if a WI pushes them near 300.
Prefer NEW test files over the four frozen-size terminal test files
(`file-size-baseline.json:104-107`). New store `vi.mock`s in tests are
mock-boundaries findings — use real stores (probe style: mock only
`@tauri-apps/api/core` and window-label). knip is at zero, but test files are
knip entry points (verified), so Phase-1 selectors consumed only by their unit
tests are fine.

**Sequencing rationale (round-2 finding):** the cd-follow guards land BEFORE
the coordinator wiring, and the full lifecycle wiring lands in the SAME phase
— otherwise the intermediate states either reproduce the injected-`cd` bug on
hidden sessions or strand sessions on close/move.

**Inner loop:** `pnpm check:fast` / `pnpm vitest related <file>`. **Pre-push:**
`pnpm check:predelta`, then one `pnpm check:all`.

---

### Phase 0 — Infrastructure & headroom

**Gate:** `pnpm check:all`; `bash scripts/check-tscope-phase.sh 0`.

#### WI-TS0.1: Plan infrastructure
Copy `scripts/check-gha-phase.sh` → `scripts/check-tscope-phase.sh`; per-phase
assertions. **WI linkage must be invoked as
`bash scripts/check-wi-linkage.sh <plan> --phase=TS<N>`** — the filter regex
builds `^WI-<arg>…` and fails closed on zero matches, so a bare numeric phase
exits 1 against `WI-TS*` ids (verified by execution).
- Tests: missing artifacts → non-zero; unknown phase → exit 64; smoke check
  that the linkage invocation finds ≥ 1 WI for phase TS0.

#### WI-TS0.2: Split `useTerminalSessions.ts` (mechanical)
Extract the bell wiring (`:165-172`) and the mount/init + store-subscription
block (`:230-281`) into sibling modules. No behavior change. **Update this
plan's own line anchors in the same change** (D-T3/D-T8 cite ranges this WI
relocates).
- AC: all existing terminal suites green unmodified; file < 250 lines.

#### WI-TS0.3: Split `workspaceInstancesStore.ts` (mechanical)
299/300, unbaselined; Phase 2's follower needs headroom. Move pure logic into
`workspaceInstancesStore/helpers.ts` (or a second helper module).
- AC: existing store suites green unmodified; file ≤ 280 lines.

---

### Phase 1 — Store model (no wiring yet)

**Gate:** `pnpm check:all`; `bash scripts/check-tscope-phase.sh 1`.

#### WI-TS1.1: Owner field + stamping helper + union cap/ordinals
`TerminalSession.workspaceInstanceId?: string`; `terminalCreateSession` takes
`ownerInstanceId?` (the slice never imports workspace stores — callers resolve
via the ONE shared helper `resolveTerminalOwnerInstanceId(windowLabel)`
implementing D-T1's three carve-outs). Cap + ordinal allocation per D-T5
(visible-union when rail on; all when off).
- Tests (new `terminalSlice.scope.test.ts` +
  `resolveTerminalOwnerInstanceId.test.ts`): stamp per carve-out (placeholder
  / restoring / rail-off → absent); cap counts the union and is a creation
  gate only (the Codex over-cap population — 5 scoped + N unscoped via the
  placeholder path — blocks creation but is representable); ordinal never
  duplicates within the visible union; rail-off allocation identical to
  today.

#### WI-TS1.2: Scope-transition actions (the kernel)
`terminalAdoptUnscopedSessions(instanceId)` — absent→instanceId, renumbers on
in-scope ordinal collision, never targets a placeholder (caller guarantees),
idempotent; `terminalSwitchScope(outgoingId, incomingId)` — records
`activeSessionId` into `lastActiveByScope[outgoingId]`, activates
remembered-live ?? first-visible ?? null, **clears `hasActivity` on the
session it activates** (same rule as `terminalSetActiveSession`, D-T11);
`terminalHydrateScope(activeId)` — same activation WITHOUT writing any
outgoing memory (hydrate/close/move have no outgoing context — round-2
ambiguity resolved: it is a distinct action, not `switchScope(null, …)`);
`terminalRemoveScopeSessions(instanceId)`; `terminalRekeyScope(oldId, newId)`
— merge per D-T6. `terminalRemoveSession` fallback-active picks from the
visible population.
- Tests (L1/L4): remember/restore per scope; empty incoming → null;
  remembered-but-closed falls back; activity cleared on restore (B→A→B with a
  bell on A's remembered session); adopt renumbers + idempotent; rekey merge
  with BOTH scopes populated (sessions merged, ordinals renumbered,
  lastActive target-wins); remove-fallback stays visible; hydrateScope writes
  no outgoing memory.

#### WI-TS1.3: Scoped selectors
`selectVisibleTerminalSessions(state, activeInstanceId, railEnabled)` =
railEnabled ? (window-scoped ∪ active-instance-scoped) : ALL;
`selectVisibleSessionCount` (invariant 7 — the only exported count).
- Tests: rail-on filtering; rail-off returns everything including stamped
  sessions (invariant 4: stamp → rail off → all visible → rail on → scoped
  again).

---

### Phase 2 — Guards + transition wiring (coordinator, lifecycle)

**Gate:** `pnpm check:all`; `bash scripts/check-tscope-phase.sh 2`.

#### WI-TS2.1: Gate cd-follow at all three sites (BEFORE any wiring)
Owner-guard (rail-aware, D-T15) in: syncRoot loop body
(`terminalSessionStoreSync.ts:172`, before `:179`), null-root invalidation
loop (`:160`), post-spawn catch-up (`useTerminalShellLifecycle.ts:205-209`),
and **inside `flushPendingRoot`** (`:65-79`) — covers the idle callback and
any future caller. Owner resolved from the store at check time.
- Tests (extend root.test with a scoped population): scoped session never
  written on root change (idle OR busy — no pendingRoot recorded); adopted
  session with a pre-adoption pendingRoot does NOT cd on next idle;
  window-scoped behavior unchanged verbatim; rail-off follows all sessions
  including stamped (D-T15).

#### WI-TS2.2: Coordinator + hydrate
`switchWorkspaceInstance`: beside `stashOutgoingInstance` (`:177`)
`terminalAdoptUnscopedSessions(outgoingId)` (skip placeholder outgoing);
after `restoreIncomingInstance` (`:182`) `terminalSwitchScope(outgoingId,
incomingId)`. `hydrateWorkspaceInstanceContext` (`:44-56`): adopt into the
final active instance + `terminalHydrateScope(activeId)`. Note (D-T12): the
restore guard is already released when hydrate runs; a user switch in the gap
adopts on its own, and hydrate's realign is convergent — pin that
idempotence.
- Tests (real stores; extend `switchWorkspaceInstance.test.ts` +
  `workspaceSwitchInterplay.test.ts`): switch A→B hides A's set; membership
  UNCHANGED (invariant 1); set-level owner-exists invariant over arbitrary
  sequences **including placeholder churn** (activate placeholder → create →
  open real workspace → placeholder deleted → session window-scoped, visible,
  adoptable — not stranded); hydrate homes the restore-race session with no
  double-create; user-switch-then-hydrate converges (no clobber).

#### WI-TS2.3: Instance lifecycle wiring (close / move / rekey / realign)
Close (`closeWorkspaceInstance.ts:125-126` block, strictly after re-validate
`:117-122`): `terminalRemoveScopeSessions(id)` + drop `lastActiveByScope`
slot + **if the closed instance was active, `terminalHydrateScope(successor)`**
(successor = the store's post-removal active, promoted `ids[0]`,
`workspaceInstancesStore/helpers.ts:28-41`). Move source cleanup
(`workspaceWindowActions.ts:32-46`, post-ack only): same kill + realign;
ack-timeout/cancel kills nothing. Rekey follower beside
`rekeyInstanceUiState`/`rekeyPaneLayout` (post-WI-TS0.3; importing uiStore
there creates NO cycle — verified round 1).
- Tests: close A kills exactly A's; close ACTIVE A with B holding sessions →
  B's remembered session becomes active (the blank-panel case, pinned);
  cancel path kills nothing; move kills after ack, not before; duplicate
  copies/kills nothing; rekey merge per WI-TS1.2.
- **Adjacent defect, fix in the same block (flagged for review):** closed-tab
  scopes are never cleaned per-instance (`tabStoreClosedScopes.ts` has no
  per-instance removal; `removeWindowClosedScopes` has zero production
  callers — verified twice). Add `removeClosedScope(windowLabel, scopeKey)`
  + call it here, with its own test. One line plus an action at the exact
  line this WI edits; skipping would re-record the leak knowingly.

#### WI-TS2.4: End-to-end store-chain integration test
Re-land the 2026-08-31 probe as a permanent test
(`terminalSessionStoreSync.railswitch.test.ts`, real stores, minimal mocks):
rail switch swaps the visible set, does NOT cd instance-scoped sessions, DOES
cd window-scoped ones; the root.test population (window-scoped) behaves
exactly as before. Runs green in THIS phase because WI-TS2.1's guards landed
first (round-2 sequencing finding). This is the regression test for the
investigated bug class; the rail→terminal chain had zero non-mocked coverage.

---

### Phase 3 — UI

**Gate:** `pnpm check:all`; `bash scripts/check-tscope-phase.sh 3`.

#### WI-TS3.1: UI filtering
`TerminalTabBar` renders `selectVisibleTerminalSessions`; `isMaxed` per the
union rule; `terminalKeyHandler` Cmd+1..5 indexes the visible list;
TerminalSearchBar key and `getActiveTerminal` consumers unchanged (D-T2).
Keep every `data-terminal-action` value verbatim (E2E contract).
- Tests: TabBar renders only the visible population (new
  `TerminalTabBar.scope.test.tsx`); a11y suite green; keyHandler positional
  switch over the filtered list; rail-off renders all (invariant 4).

#### WI-TS3.2: Shared auto-create helper + empty state
`maybeAutoCreateTerminalSession(windowLabel)` (D-T8) used by BOTH creators —
the panel effect (re-fires on `[visible, activeInstanceId]`) and the
mount-time creator. Gate = `canAutoCreateInScope` on the synchronous
instance-backed scope, never `canOpenTerminal`. Refusal → empty-state hint:
new flat key `terminal.noWorkspaceSession` in `src/locales/en/statusbar.json`
+ all 9 locales — flat keys only (`localeShape.test.ts:80`), no trailing
period (i18n-copy), genuinely translated (`terminalI18nCoverage.test.ts`
covers statusbar `terminal.*` — verified; untranslated baseline stays EMPTY).
- Tests: switch into empty workspace scope, panel visible → one stamped
  session; switch into refusing scope **with the legacy refresh unresolved** →
  no create, empty state (the RED test the legacy gate cannot pass);
  mount-time path with restored-visible panel over a refusing scope → no
  `$HOME` spawn (round-2 case); no re-create when scope non-empty.

#### WI-TS3.3: Visible-scope "last session" semantics
`TerminalPanel.handleClose` and `closeSessionOnCleanExit` compute last-ness
on the visible population (D-T7).
- Tests: clean exit of the visible population's only session hides the panel
  while a hidden scope holds sessions; closing a non-last visible session
  does not.

---

### Phase 4 — Spawn & pickers

**Gate:** `pnpm check:all`; `bash scripts/check-tscope-phase.sh 4`.

#### WI-TS4.1: Spawn context contract
Implement `resolveTerminalSpawnContext(windowLabel, session)` per D-T9 (pure;
full matrix: requestedCwd / same-scope sibling / stamped owner present /
owner deleted / unscoped / loose-with-file). Lifecycle resolves once
pre-await; `spawnPty` takes `workspaceRoot` as a parameter (stops re-resolving
at `:189`); `VMARK_WORKSPACE` matches the owner even mid-switch. NOTE:
`resolveTerminalWorkspaceRoot`'s missing `isWorkspaceMode` check
(`spawnPty.ts:96` vs sync's `:149`) is EXISTING behavior for the unscoped
fallback — preserve, don't silently fix.
- Tests: the contract matrix (L1, table-driven); sibling inheritance ignores
  other-scope sessions; spawn env root == owner root under a simulated
  mid-spawn switch (L5 on the spawn seam).

#### WI-TS4.2: Out-of-tree pickers
`reuseOrCreateTerminalSession` picks from the visible population (D-T10);
`openTerminalHere`/`canOpenTerminalHere` cap per union; created sessions
stamped via `resolveTerminalOwnerInstanceId`. `runInTerminal` unchanged — add
a test PINNING id-pinned delivery across a rail switch.
- Tests: reveal creates in the active scope; Open-Terminal-Here at cap
  refuses with the existing reason; runInTerminal delivers to the originally
  targeted session after a switch.

---

### Phase 5 — E2E, docs, i18n

**Gate:** `pnpm check:all`; new journey green locally against a debug app;
`cd website && pnpm build`; `bash scripts/check-tscope-phase.sh 5`.

#### WI-TS5.1: Rail e2e plumbing
Stable selectors: `data-rail-action="activate|duplicate"` +
`data-instance-id` on rail buttons. New `e2e/lib/rail.mjs`:
`withRailMode(client, enabled, fn)` (StorageEvent settings patch — verified
live rehydration), `clickRailInstance(client, instanceId)`,
`getRailInstances(client)`.
- Tests: WorkspaceRail.test.tsx pins the new attributes.

#### WI-TS5.2: Journeys
(a) Journey 18 wrapped in `withRailMode(client, false, …)`; headers of 17/18
updated — I15 is explicitly the *legacy/window-scoped* cd-follow.
(b) New `35-terminal-rail-scoping.mjs`: rail ON; workspaces A+B; session in A
(record pid); rail-click to B → A's pid **alive, cwd unchanged**
(`getAppShellCwds` pid identity), tab set swapped (DOM), new session in B
spawns in B; switch back → same pid revealed, same cwd. House skip rules;
teardown restores rail setting + panel visibility, removes temp dirs.
(c) Append to `tier0-e2e.yml`'s hardcoded list (`:180-189`).
(d) Update `dev-docs/e2e-tier0-matrix.md`.

#### WI-TS5.3: Website docs
`website/guide/terminal.md` + `website/guide/workspace-rail.md` (terminal
section). Add the missing `workspace-rail.md` mapping row to
`.claude/rules/21-website-docs.md` (page exists, unmapped — 1 line, same
change). Verify `cd website && pnpm build`.

#### WI-TS5.4: Locale sweep
All new keys translated in de/es/fr/it/ja/ko/pt-BR/zh-CN/zh-TW. Use the
`translate-docs` flow if the string count warrants it.

---

## Risks & assumptions

- **Biggest structural risk: per-instance cleanup is a hand-maintained
  checklist** (close/move/rekey/placeholder-deletion — exactly how the
  closed-scopes leak and the placeholder hole happened). Mitigation is
  structural: the **set-level owner-exists invariant test** (WI-TS2.2) runs
  arbitrary lifecycle sequences including placeholder churn, so a forgotten
  follower fails a test regardless of which lifecycle forgot it; D-T1 keeps
  placeholders out of the owner vocabulary entirely; and ALL lifecycle wiring
  lands in one phase (round-2 sequencing).
- **Unbounded total sessions across scopes** (D-T5): accepted with mechanism
  (one gated click per creation; cheap hidden sessions). Named follow-up: if
  field feedback shows runaway populations, measure (PTY count/RSS via
  `getAppShellCwds`-style probe) and add a window ceiling then.
- **`workspaceInstanceUiStore`'s documented lifecycle is partly fiction**
  (`copyInstanceUiState`/`copyPaneLayout`: zero production callers). Don't
  model terminal-copy on it. Fixing that header is out of scope.
- **Move/duplicate already orphan per-instance UI state cross-window**
  (rail-plan gap G2, outstanding). Terminal gets an explicit policy (kill +
  realign); G2 stays G2.
- **Assumption:** `activeSessionId = null` with a visible panel renders
  acceptably during the one-frame gap before auto-create; if a flash shows,
  batch switchScope + create into one store update.
- **Deferred (named):** rail-item activity badge; fish/Windows shell
  integration (scoping removes their worst failure mode here anyway); rail
  default flip (D-T14); window-level session ceiling (measured-if-needed).

## Review rounds

**Round 1 — adversarial refuter panel (3 lenses, 2026-08-31).** 12 findings,
11 accepted, 1 self-refuted (knip fear — test files are knip entries).
Accepted: placeholder stranding (blocker → D-T1), rail ON→OFF stranding
(→ D-T15), close/move-of-active blank panel (→ D-T6), ordinal union/adoption
collision (→ D-T5), restore race defeats adoption (→ D-T1), gate races legacy
store (→ D-T8), `flushPendingRoot` third cd site (→ D-T4),
`workspaceInstancesStore.ts` 299/300 (→ WI-TS0.3), `--phase=TS<N>` spelling
(→ WI-TS0.1), stale anchors after split (→ WI-TS0.2), knip hedge deletion.
Verified in the plan's favor: D-T2 null-safety, D-T3 (no other disposal
path), D-T9 race description, no uiStore↔workspaceInstancesStore cycle,
`withRailMode` live rehydration, `terminalI18nCoverage` statusbar coverage.

**Round 2 — Codex cross-model review (thread `01a056ad-7912-7533-9001-699fda8706ed`,
gpt high-effort, read-only; reviewed v1).** Verdict on v1: MAJOR GAPS — its 3
criticals were the same as round 1's (convergent: rail-off, flushPendingRoot,
close/move successor; already fixed in v2). Newly accepted from round 2:
Phase-2-test-needs-Phase-3-guards sequencing (→ guards moved to WI-TS2.1,
lifecycle consolidated into Phase 2), switchScope activity-clear bypass
(→ D-T11/WI-TS1.2), ungated mount-time creator (→ D-T8/WI-TS3.2),
`resolveTerminalSpawnContext` contract (→ D-T9/WI-TS4.1),
`terminalHydrateScope` argument semantics (→ WI-TS1.2), rekey merge
semantics with both scopes populated (→ D-T6/WI-TS1.2), adoption over-cap
via the placeholder path (→ D-T5 cap-as-creation-gate), selector count
vocabulary (→ invariant 7), FALSE restore-guard citation (verified by
reading `_hotExitRestore.ts:75-97`: `endWindowContextRestore` is in the
`finally`, hydrate awaited after → D-T12 rewritten with the convergence
argument). **Overruled, with mechanism:** a hard window-level session ceiling
(D-T5: creation is a gated single user click; cost per hidden session is one
idle PTY + MBs; ceiling deferred to a measured follow-up rather than guessed
now) and a CI soak test for 20×5 PTYs (same — measured-if-needed, recorded
under Risks).

## Verification map

| Phase | Commands |
|---|---|
| 0 | `pnpm check:all` && `bash scripts/check-tscope-phase.sh 0` |
| 1 | `pnpm check:all` && `bash scripts/check-tscope-phase.sh 1` |
| 2 | `pnpm check:all` && `bash scripts/check-tscope-phase.sh 2` |
| 3 | `pnpm check:all` && `bash scripts/check-tscope-phase.sh 3` |
| 4 | `pnpm check:all` && `bash scripts/check-tscope-phase.sh 4` |
| 5 | `pnpm check:all` && journey 35 green (local debug app) && `cd website && pnpm build` && `bash scripts/check-tscope-phase.sh 5` |

Before every push: `pnpm check:predelta`, then one `pnpm check:all`.
