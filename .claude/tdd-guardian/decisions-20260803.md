# Decision ledger — plan-20260803-161713

Consequential behavioral decisions for the 2026-08-03 architecture-review plan. Created per the
Codex cross-review amendment (archived at
`dev-docs/audit/20260803-crosscutting-notes-codex-review.md`): pin the INVARIANT at RED; pin a
MECHANISM only when it is user-visible contract; record anything with blast radius here — with
rationale and rejected alternatives — and link the entry from the test-file header instead of
burying the decision in a one-line comment.

Status values: OPEN (decide at that WI's RED), RESOLVED (decision recorded, tests pin it).

---

## D1 — WI-1: Source link popup, doc change while popup open — RESOLVED (2026-08-03, at RED)

- **Invariant (pinned)**: a stale write can never happen — save asserts on the
  final document string; dispatching captured offsets after an unmapped doc change is forbidden.
- **Decision**: remap-when-mappable / close-when-destroyed (the matrix default), two layers:
  1. A dedicated CodeMirror `updateListener` extension inside `createSourceLinkPopupPlugin`
     remaps `[linkFrom, linkTo)` through `update.changes.mapPos` on every doc change while the
     popup is open, accepting the remap only when the mapped slice is byte-identical to the
     pre-change slice (verbatim link-identity check — stronger than parse-success, which a
     same-length replacement of the whole link would defeat). Anything else closes the popup.
  2. Defense in depth: `saveLinkChanges`/`removeLink` re-validate at dispatch time — INSIDE the
     IME-queued action, so a queued save re-reads state at execution — that the captured range
     still parses as link markdown; on failure they abort, close the popup, and never dispatch.
- **Rationale**: the `ChangeSet` exists only at doc-change time, so remap must live in the
  update listener (a separate leaf extension: `createSourcePopupPlugin.ts` and
  `SourcePopupView.ts` are file-size-baselined and cannot grow). Remap chosen over close-always
  because `mapPos` supports it cleanly and it preserves the user's in-flight popup edit during
  MCP/AI edits elsewhere in the doc — cases 1/3/6 assert remap semantics on the final doc string.
- **Retarget (shouldReshow port)**: implemented as a second, subclass-local store subscription in
  `SourceLinkPopupView` (same reason: the base class is size-frozen); range change while open
  refreshes input/bookmark state and position; focus/select re-runs only when the href actually
  changed, so a remap under a typing user never clobbers or reselects the input.
- **Reference behavior**: WYSIWYG `linkRangeIsIntact` (commit c89c1656).

## D2 — WI-2: `setActiveTab` targeting a tab owned by the non-focused pane — RESOLVED (2026-08-03, at RED)

- **Invariant (pinned)**: after ANY activation, the focused pane's active tab equals
  `tabStore.activeTabId`. Browser-tab aliases are exempt: panes hold documents, browser
  surfaces overlay the editor (the same document-only rule `replaceWindowSplit` enforces).
- **Decision**: **focus follows the tab**, uniformly, enforced at ONE seam instead of ~31 call
  sites: tabStore announces every activation (createTab, createTransferredTab, setActiveTab,
  the post-close/detach neighbor pick) on `tabActivationBus` — the tabRemovalBus cycle-breaking
  shape — and paneStore converges: a tab already shown in the OTHER pane pulls focus to that
  pane; an unpaned document lands in the focused pane; browser tabs never touch panes. The 5
  call-site split checks (`activateTabInFocusedPane`, `activateTabWithWorkspaceContext`,
  `reopenClosedTab`, `reassignTabOwnershipForPath` ×2, mcpBridge `workspaceOpen`) are deleted;
  they all reduce to plain `setActiveTab`.
- **Rationale**: activating a visible tab means "reveal it", not "clone it". Moving focus is the
  smallest state change that restores the invariant, and it never creates the
  `primary === secondary` duplicate split that `replaceWindowSplit` already treats as invalid
  and collapses. The pre-WI-2 sanctioned path (`setFocusedPaneTab` via
  `activateTabInFocusedPane`) would have DUPLICATED the document into the focused pane in
  exactly this case — part of the bug class, not a contract: no test pinned it, and
  reassignTabOwnershipForPath's R2-F7 test computes the focused pane dynamically, so it stays
  green under focus-follows.
- **Rejected**: tab-moves-to-focused-pane (creates the duplicate-pane state);
  reject-the-activation (background/programmatic activations would silently fail and leave the
  alias stale — the original bug with extra steps).
- **DEV guard**: `assertPaneTabInvariant` (paneStore) throws on violation in DEV
  (`import.meta.env.DEV`, injectable for tests), no-op in production; runs after every bus
  convergence.

## D3 — WI-11/WI-18: comment literals and mocking-variant coverage in checker scripts — RESOLVED

- **Decision**: these are NOT product decisions; they derive from the gate's threat model.
  All coupling channels (including legacy `@/stores`) parse imports — comments never count; the
  documented "prose counts as coupling" landmine (00-engineering-principles, two debugging rounds)
  is removed, and the rules note is updated in the same change. Safe because the stores baseline
  is zero — zero stays zero under either counting rule. WI-18 counts EVERY Vitest mocking variant
  (`vi.mock`, `vi.doMock`, dynamic import form, relative paths resolving into `src/stores/`,
  `__mocks__/` dirs) across test files AND helpers; no variant is "documented out of scope".
- **Rejected**: preserving legacy grep semantics for the stores channel (fossilizes a known false
  positive); leaving `doMock` out of scope (an evasion channel, not an edge case).

## D4 — WI-13: format-adapter thunk rejection retry semantics — RESOLVED (2026-08-03, at RED)

- **Invariant (pinned)**: a rejected thunk produces a defined, observable error surface —
  never a silent blank editor. The error is typed (`FormatSurfaceLoadError`) and names both the
  adapter and which surface failed; the mount path renders a `role="alert"` failure state
  carrying `data-format-surface-error="<formatId>"`.
- **Decision — RETRY ON NEXT MOUNT.** The resolution cache
  (`src/lib/formats/lazySurfaces.ts`) memoizes **fulfilled results only**. A rejection is
  evicted from the in-flight map before it propagates, so the next mount re-invokes the thunk.
  Concurrent callers that joined the same in-flight attempt all observe that attempt's
  rejection (one evaluation, one failure), and the attempt AFTER it starts fresh.
- **Rationale**: the chunk lives on local disk inside the app bundle, so a failure here is
  transient by construction — a partially-written update, a file lock, an OOM — not a permanent
  "this build has no such module". Sticky failure converts one transient fault into a dead
  editor surface until the user quits the app, and the primary surface is markdown. Retry costs
  nothing when nothing fails (the success path is cached and never re-invoked), and it makes the
  user's natural recovery gesture — switch tabs, reopen the file, toggle the view — an actual
  recovery instead of theatre.
- **React.lazy is the trap this decision exists to avoid**: `React.lazy` caches the REJECTED
  promise for the lifetime of the lazy component object, so the naive wiring is sticky-by-accident
  and no test would notice. The mount path therefore builds a fresh lazy component per attempt
  (`formatId#attempt`) rather than reusing one per format id.
- **Rejected**: sticky-until-restart (simpler, but its only advantage is not re-paying a failed
  import — an import that has already proven to cost nothing, since it failed); retry-with-backoff
  (there is no remote to be polite to, and mount frequency is user-paced already).

## D5 — WI-15: zod unknown-field posture — RESOLVED (per boundary class, not globally)

- **Decision**: there is no single strip-vs-reject answer; posture follows the boundary class:
  - **Persistence reads** (hot exit, session tabs — WI-3): passthrough. Forward compatibility
    across app versions; corrupt ≠ unknown.
  - **Untrusted MCP tool input** (WI-15): explicit per-operation-class posture, asserted per
    operation. Silent strip is what made the `windowId` routing branch born-unreachable; where a
    field is load-bearing for routing, unknown-field strip must be either rejected or logged
    loudly enough that a dead branch cannot hide.
- **Rejected**: "pick one at RED and pin it" (the original matrix line) — it flattens two threat
  models into one toggle.

## D6 — WI-17: save racing external change — RESOLVED (2026-08-04, at RED)

- **Invariant (pinned)**: **no unsaved user bytes are ever silently discarded, and no external
  bytes are ever silently overwritten without a flagged conflict** — in every outcome below.

### The protocol, as implemented and now pinned

**Winner.** The SAVE always wins the file; the external change always wins the *question*. A save
carries no disk precondition — it writes, unconditionally, so the user's unsaved bytes can never
be stranded by someone else touching the file. An external change never rewrites the buffer of a
dirty document without asking first. Last writer wins the FILE; the user's buffer is never the
casualty.

**Version check is CONTENT IDENTITY, not mtime.** mtime is read exactly once in the whole
pipeline — `suppressUnchanged` calls `stat` for a *size* cap — and is never compared. Three
content mechanisms carry the protocol instead:

| Mechanism | Question it answers |
|---|---|
| `utils/pendingSaves` — exact bytes registered before the write, cleared 1000 ms after | "is this watcher event our own save echoing back?" (`matchesPendingSave`, plus the upstream `selfWrite` flag in `normalizeFsEvents`) |
| `documentStore.lastDiskContent` + `softContentEquals` | "did the file actually change, or did a cloud client rewrite line endings / BOM / the trailing newline?" |
| `contentHashCache` / `suppressUnchanged` | "is this a no-op touch?" — it never reaches the reaction layer |

Timestamps are deliberately excluded: their resolution is platform-dependent and they race the
watcher (the decision is recorded in `utils/pendingSaves.ts`). Pinned by
`externalChange.test.ts` — "mtime alone is NOT the signal".

**Disk bytes and dirty state, per outcome.**

| Situation | Disk after | Buffer | Dirty | Divergent |
|---|---|---|---|---|
| External change, doc CLEAN | external bytes | replaced by disk (`documentId` bumps → editor remounts) | false | false |
| External change, doc DIRTY → *Keep my changes* | external bytes (VMark writes nothing) | **unchanged** | true | **true** — and autosave skips divergent docs, so the buffer can never silently overwrite the external bytes later |
| External change, doc DIRTY → *Reload* | external bytes | replaced (an explicit user act) | false | false |
| External change, doc DIRTY → *Save As* | external bytes keep the old path; the buffer goes to a new one | unchanged | false | false |
| Save succeeds (whether or not a conflict was flagged) | the saved bytes | unchanged | false, unless the buffer moved mid-write (`buildPostSaveState` compares against what was actually written) | cleared |
| Save FAILS | untouched | unchanged | **stays true** | unchanged |
| File deleted externally | absent | unchanged | unchanged | — (`isMissing` set; no auto-close) |

**Notification.** Clean reload → info toast. Dirty single file → the three-option native dialog
(`resolveDirtyFileChange`); several files → the reload-all / keep-all / review-each dialog. A
rejected batch is re-queued, never resolved in the filesystem's favour. Manual save failure → a
pinned error toast; autosave failure stays quiet by design (a flaky disk must not toast per
interval) and the retained dirty flag is the signal. A vanished parent directory marks the
document missing and routes the save into Save As.

**Residual window, stated rather than hidden.** VMark performs no read-and-compare before
writing, so an external write that lands *after* the last observation and *before* our write is
overwritten without a conflict flag. The window is bounded by watcher latency (Rust debounce
200 ms + bus coalesce 50 ms + the disk read). It is accepted: a stat/hash precondition on every
save would cost an extra round trip on the hot path, would not close the window (TOCTOU just
moves inside it), and would refuse saves after benign cloud rewrites — trading a rare loss of
*other* people's bytes for frequent blocking of the user's own. Pinned by
`externalChange.test.ts` — "an UNOBSERVED external write landing mid-save".

- **Rejected**: an mtime/version precondition that blocks the save (platform-dependent
  resolution; blocks on benign rewrites; does not close the TOCTOU window); automatic three-way
  merge (silent merges are how editors corrupt prose); blocking the save until the conflict is
  resolved (a dismissed dialog would leave the user's unsaved bytes with nowhere to go — it
  breaks the first half of the invariant to protect the second).
- **Pinned by**: `src/test/tier0/externalChange.test.ts` (cases 5, 6, 8) and
  `src/test/tier0/saveFlow.test.ts` (cases 1, 7, 9), both driving the real composition against
  the stateful fs fake.

## D7 — WI-1: empty/whitespace URL on save — RESOLVED (2026-08-03, at RED)

- **Decision**: unlink (remove the link markdown, keep the text). This is WYSIWYG's existing
  behavior — `LinkPopupView.handleSave` routes a trimmed-empty href to `handleRemove()` — and the
  Source view (`SourceLinkPopupView.handleSave`) already does the same at the view level. The fix
  mirrors it at the ACTION level in `saveLinkChanges` (empty/whitespace href → replace the range
  with its link text), so the two surfaces agree even when the action is driven directly
  (MCP, tests) rather than through the view. Asserted on exact doc text (matrix WI-1 case 5).
- **Rejected**: reject-and-keep-open — it would make the action disagree with both shipped views.

## D8 — WI-5: formatter idempotence — RESOLVED (2026-08-03, at RED via property counterexamples)

- **Invariant (pinned)**: `formatMarkdown(formatMarkdown(x, c), c) === formatMarkdown(x, c)` —
  the formatter is a normalizer and must converge in ONE user-visible invocation; repeated
  "Format CJK File" must never keep editing the document. Enforced by
  `src/lib/cjkFormatter/__tests__/idempotence.property.test.ts` (generated documents, boundary
  corpus, pinned shrunk counterexamples, determinism, fixed points).
- **Decision — convergence wins over single-pass output**: `applyRules` iterates its rule chain
  to a fixed point (cap 8; hitting the cap is a bug the property suite exists to surface). The
  chain has producer→consumer dependencies no single ordering satisfies (quote conversion
  produces corner brackets that are fullwidth/dash context; fullwidth parens run late; nesting
  needs one pass per level), so the fixed point — not the first pass — is the contract.
- **Decision — quote decisions must be stable under the pipeline's own spacing** (user-visible):
  CJK-involvement boundary checks skip spaces/tabs, so `"hi" 中文` now takes CJK-style quotes
  where it previously stayed straight — the space the formatter itself inserts between a quote
  and CJK text cannot be allowed to flip the decision on the next pass. Same rationale for
  curly glyphs carrying their intrinsic roles (“/‘ open, ”/’ close) instead of whitespace-context
  classification.
- **Decision — corner glyphs are never rewritten**: 「」『』 participate in pairing topology
  (via `cornerBracketsAsQuotes`, used only by `applyContextualQuotes` — quoteToggle matches
  corners itself) but are never replaced; user-authored corners stay as written.
- **Rejected**: weakening the property to pass (explicitly forbidden by the WI); reordering the
  whole rule chain (constraint graph is cyclic); whole-pipeline fixpoint WITHOUT the decision
  fixes (oscillating decisions never converge — the fixpoint loop only terminates because every
  individual decision is stable under the pipeline's own rewrites).

## D9 — WI-6: the live-webview bound is the surface lifecycle, not a cap store — RESOLVED (2026-08-03, at RED)

- **Invariant (pinned)**: the number of live native webviews per window never exceeds the
  number of active browser pages (= 1): one `BrowserSurface` mounts for the active page only,
  and `useBrowserNativeView` invokes `browser_destroy` on unmount. Pinned in
  `src/components/Browser/browserLifecycleBound.test.tsx` against a stateful `@tauri-apps`
  invoke fake (create adds / destroy removes; the fake's live COUNT is asserted, not call
  choreography). RED shown twice against deliberately-broken variants: destroy disabled
  (4/5 fail — the leak) and render-all-pages (2/5 fail — `expected 5 to be 1`).
- **Decision — DELETE, not wire** (E4): the hibernation store (`stores/` LRU cap,
  DEFAULT_MAX_LIVE=3) had zero production consumers and the leak its cap would bound was
  REFUTED; the shipped active-page-only lifecycle is strictly tighter (1 < 3). Deleted the
  store + its test; `scripts/check-browser-phase.sh`'s "WI-1.6 live-webview cap enforced" row
  now runs the lifecycle-bound pin instead of certifying an unwired policy. The Rust
  `Lifecycle::Hibernated` variant (dead code "awaiting WI-1.6") is removed with its
  transitions; the registry doc records why there is no hibernated state.
- **Rejected**: wiring the cap (bounds nothing the lifecycle doesn't already bound tighter;
  plan's own Deferred section rejects it); keeping the enum variant with an updated comment
  (the state is unreachable by construction — a modeled-but-impossible state is the same
  fiction class the WI exists to kill, and the removal ripple was two files).

## D5a — WI-15: the posture as implemented, and the `windowId` verdict — RESOLVED (2026-08-04, at RED)

Follows D5. The wire contract now has ONE declaration —
`server/mcp/src/bridge/operationSchemas.ts`, a zod object per `vmark.*`
operation — from which `pnpm gen:mcp-contracts` emits the sidecar's
`BridgeRequest` union and the webview's field descriptors / argument types /
posture. `pnpm lint:mcp-contracts` (in `check:all`) regenerates and fails on
any difference, so a hand-edit of a generated copy is a gate failure.

- **Posture per class (pinned by `operationPosture.test.ts`)**: `workspace`,
  `document`, `workflow`, `selection`, `browser`, `coherence` → **reject**;
  `session` → **strip-and-log**. The rule behind the split is not a taste
  call: every class that can select a TARGET (`tabId`, `windowLabel`,
  `filePath`, `folderPath`, `workspace_root`) refuses an undeclared field,
  because a field the caller believed was routing them somewhere, silently
  dropped, IS the `windowId` failure. `session` is the one exception and only
  because its single field (`clientProtocol`) exists to survive version skew;
  it drops unknown fields but logs them, so nothing hides there either.
  Enforced outbound in `sendBridgeRequest` (a payload out of contract cannot
  reach the wire) and reported inbound by `readOperationArgs` in the webview.
- **Inbound posture is report-only, deliberately**: the webview logs an
  undeclared field rather than refusing the request. Refusing would break
  version skew in the direction it actually happens (newer sidecar, older
  app), and the sidecar already refuses at the producing end.
- **`windowId`: DELETED, not repaired.** Evidence: no sidecar tool sends it
  (the only mention left in `server/mcp` is a comment recording its removal in
  audit 20260728 §4); the wire contract declares it on none of the 34
  operations; the webview never emits it. Explicit window targeting DOES ship
  — as `windowLabel` on `workspace.new`/`open`/`focus_window`, resolved by the
  webview handler that receives the request. So `pick_target_window`'s
  `explicit` branch and the "close one or pass windowId" refusal are gone, and
  `window_routing.test.rs` proves every shipped payload shape routes without a
  pin. **Rejected**: renaming the branch to read `windowLabel` — that would
  give routing a precedence it has never had (an explicit label would start
  overriding workspace containment, turning working `workspace.open` calls
  into "does not own the workspace" conflicts). A behaviour change, not a
  repair.
- **`args.clientId` (found at the same RED)**: same class, same fix. The
  open_workspace one-shot approval read a `clientId` the bridge event does not
  carry and no contract declares, behind a constant fallback that was the only
  branch that ever ran. The read is deleted and the constant named
  (`ONE_SHOT_CLIENT_ID`), so the code now says what is true: the grant binds
  per SESSION, not per client. Making it per-client is Codex F-10 and needs
  Rust to carry the authenticated principal — it cannot be faked from a field
  nobody sends.
