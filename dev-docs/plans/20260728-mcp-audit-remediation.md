# MCP Stack Audit Remediation

**Status:** COMPLETE (2026-07-28) — all 10 WIs DONE, plus two rounds of
independent Codex audit-fix.

Final gates, all green after round 2:

| Gate | Result |
|---|---|
| `pnpm check:all` | exit 0 |
| `cargo test --lib` | 1657 passed, 0 failed (baseline 1513) |
| `cargo clippy --all-targets -- -D warnings` | clean |
| `cargo fmt --all -- --check` | clean |
| `scripts/check-cross-target.sh` | Windows target compiles clean |
| `scripts/check-coherence-phase.sh 1` | 50 passed, 0 failed |

See Outstanding below for items deliberately left open.
**Owner:** Xiaolai
**Evidence:** `dev-docs/deep-researches/20260728-mcp-stack-audit.md`
**Created:** 2026-07-28

## Goal

Close the defects found by the 2026-07-28 four-surface MCP audit, in the order
that audit's §8 recommends. Data-loss bugs first, then the config writer, then
the security comment and bridge hardening, then test-gate honesty and tool
quality.

## Non-goals

- Re-expanding the tool surface. The 7-tool / ~34-action shape is the
  deliberate outcome of `20260504-mcp-pruning.md` and stays.
- Changing the transport. The audit's benchmark says stdio + loopback WS with a
  token is on the correct side of the 2025–26 CVE class; UDS is a future
  option, not this plan.
- Deciding whether per-client credentials replace the shared bridge token
  (WI-6 fixes the false comment; the mechanism is a separate decision).

## Work items

Each item cites the audit section that justifies it. Status blocks are stamped
beneath each heading as the item lands.

### WI-1 — Bump the revision on source-mode edits (§1.1)

**Status:** DONE — 2026-07-28
**Changed:** `src/stores/documentStore/document.ts`, `src/stores/documentStore/__tests__/contentRevisionSync.test.ts`
**Verified:** `pnpm vitest run` on the revision suites (20 passed) + regression sweep across `mcpBridge`, `documentStore`, `stores`, `services/history` (978 passed)

**Scope note — the audit under-counted.** It named only `SourceEditor.tsx`, but
`setContent` has ten non-MCP callers, and `SplitPaneEditor/SourcePane.tsx`, the
GHA workflow side panel (`GhaWorkflowSidePanel.tsx:215,222`), `useDocumentState`,
`unifiedHistory` and hot-exit `restoreHelpers` all mutated content without
bumping too. Fixing only the source editor would have left the same bug on four
other paths, so the bump went into `setContent` itself — the single choke point
every writer passes through. Guarded on `previous.content !== content` so the
RAF-debounced Tiptap flush, which re-serializes and re-sets identical content on
every update, cannot trigger a false STALE.

Revision bumps are wired only into the Tiptap transaction listener
(`TiptapEditor.tsx:185`, the sole `initializeRevisionTracking` call site).
CodeMirror source-mode typing calls `documentStore.setContent`, which never
touches the revision store, so a *correct* `expected_revision` captured before
those keystrokes still passes `isCurrentRevision` and the AI write clobbers
them — and persists the loss, since `document.write` saves by default.

**DoD:** a RED test proving a source-mode edit invalidates a previously-read
revision; source-mode edits bump the revision; `pnpm vitest run` green.

### WI-2 — Propagate `mcp_config` parse failures (§1.2)

**Status:** DONE — 2026-07-28
**Changed:** `src-tauri/src/mcp_config/{config_io.rs, commands.rs, mod.rs}`, new `install_io.rs`, new `config_io.test.rs` (14 tests), new `install_io.test.rs` (9 tests)
**Verified:** `cargo test --lib` — `1576 passed; 0 failed`; `cargo clippy --all-targets` clean; `cargo fmt --check` no diffs; file-size gate passes

RED first, quoted: *"malformed JSON must not fall back to an empty config"* — the
failure output showed the user's entire `~/.claude.json` replaced by a four-key
vmark-only document. Beyond the parse fix, install/uninstall were **reordered so
validation precedes any write**, so a malformed config now fails with the user's
disk byte-identical and no stray backup; backups moved from `fs::copy` (which
truncates) to `create_new` with a suffix search, so a same-second collision can
no longer destroy an earlier backup; and `read_config_for_merge` now maps only
`NotFound` to "fresh install" instead of collapsing permission and non-UTF-8
errors into it. `config_io.rs` was split at 301 lines (one over the gate) along
the natural content-vs-disk seam.

**New defect found, not in the audit:** `serde_json` is built without
`preserve_order`, so `Value::Object` is a `BTreeMap` and every install/uninstall
**alphabetically re-sorts all keys in `~/.claude.json` at every nesting level**.
Not data loss, but a whole-file diff on a config users keep in git. One-line
feature flag, but feature unification makes it a crate-wide decision — see
Outstanding.

`config_io.rs:82-83,107` parse an existing config with `.ok()` and fall back to
an empty document, so a malformed `~/.claude.json` (Claude Code's entire state)
is discarded and rewritten as a vmark-only file. The uninstall path in the same
module already errors correctly — match it.

**DoD:** malformed JSON and malformed TOML each return `Err` from the install
path; table-driven tests exist for the module (currently zero); `cargo test`
green.

### WI-3 — Guard `workspace.open` against dirty-tab reset (§1.3)

**Status:** DONE — 2026-07-28
**Changed:** `src/hooks/mcpBridge/v2/workspace.ts`, `src/hooks/mcpBridge/v2/__tests__/workspace.test.ts`
**Verified:** `pnpm vitest run` on the workspace suites — 44 passed

An already-open **dirty** tab is now focused rather than reloaded, and the
response says so (`alreadyOpen: true, reloaded: false` plus a `reason` string),
so the agent cannot silently assume it is looking at fresh disk content. A clean
already-open tab still reloads — that use case is legitimate — but now bumps the
revision when the disk content actually differs, closing the same
stale-revision hole WI-1 addressed on the editing path.

`createTab` dedupes by normalized path and returns the existing tab id; the
handler then calls `initDocument` unconditionally, resetting a dirty tab to
disk content with no checkpoint and no revision bump.

**DoD:** opening an already-open dirty tab does not discard the buffer; a test
covers it.

### WI-4 — Read-only guard must check the targeted tab (§1.4)

**Status:** DONE — 2026-07-28
**Changed:** `src/services/editor/readOnlyGuard.ts`, `src/hooks/mcpBridge/handleRequest.ts`, `src/services/editor/readOnlyGuard.test.ts`, `src/hooks/mcpBridge/__tests__/handleRequest.test.ts`
**Verified:** `pnpm vitest run` on both suites — 22 passed

New `isTargetDocReadOnly(tabIdArg)` resolves the tab the mutation targets and
falls back to the active tab when no `tabId` is supplied (the `selection.set`
case). Tests pin both failure directions the audit named — a read-only
background tab is now blocked, and a writable background tab is no longer
refused because the *active* doc is read-only — plus non-string `tabId` falling
back rather than throwing, and an unknown tab reporting writable so the handler
raises its own `TAB_NOT_FOUND` instead of a misleading `READ_ONLY`.

`handleRequest.ts:37` enforces via `isActiveDocReadOnly()` while
`document.write`, `document.transform` and `workflow.apply_patch` all accept a
`tabId`. Writes to read-only *background* tabs bypass the guard; writes to
writable background tabs are wrongly rejected when the active doc is read-only.

**DoD:** the guard resolves the request's target tab; tests cover both the
bypass and the false-rejection direction.

### WI-5 — `save_as` must not silently overwrite (§1.5)

**Status:** DONE — 2026-07-28
**Changed:** `src/hooks/mcpBridge/v2/workspaceSaveAs.ts`, `src/hooks/mcpBridge/v2/__tests__/{workspaceSaveAs,workspace}.test.ts`
**Verified:** `pnpm vitest run` on the workspace suites — 44 passed

Chose the semantic split over a new `overwrite` argument, because the latter
would have meant changing the tool schema in the sidecar (a concurrently-edited
package) for no safety gain: **`autoApproveEdits` authorises saving to a new
location, never destroying an existing one.** An existing target that is not the
tab's own path is refused with `APPROVAL_REQUIRED` regardless of the setting.
Saving over the tab's own path is still a save, not a clobber. `fs:allow-exists`
was already in the capability set, so no permission change. The refusal names
the file that would have been destroyed and tells the agent what to do instead.

`workspaceSaveAs.ts:79-100` writes with no existence check, over allowed roots
that include the parent directory of every open document.

**DoD:** writing to an existing path that is not the tab's own path requires
approval or is refused; a test covers it.

### WI-6 — Correct the `authenticated_principal` comment (§2.1)

**Status:** DONE — 2026-07-28
**Changed:** `src-tauri/src/mcp_bridge/{state.rs, coherence_answers.rs, server.rs}`
**Verified:** `cargo test --lib` — 1576 passed (comment-only, no behavior change)

Three copies of the overstatement, not one — a third lived at `server.rs:483`
("binds only to the client's AUTHENTICATED identity") and was found by grep. All
now state the real property: the string is caller-supplied and re-sendable, the
token proves possession of one shared secret and cannot distinguish holders, and
any token-holder can claim another client's name and inherit its grants. Each
notes what the value *is* good for (partitioning cooperating clients, receipt
attribution) and points at per-client credentials as the mechanism change.

`state.rs:131-142` claims the principal is "never a caller-supplied argument".
It is `identity.name` from the client's `identify` message, which any
authenticated client may send and re-send, and it gates `coherence.resolve`
delegation grants.

**DoD:** the comment states the actual trust property; no behavior change.

### WI-7 — Make the sidecar coverage gate real (§3.1)

**Status:** DONE — 2026-07-28
**Changed:** `vmark-mcp-server/vitest.config.ts`, root + package `package.json`, `scripts/check-file-size.mjs`, `scripts/file-size-baseline.json`, new `__tests__/integration/{sdkBoundary,sdkRoundTrip}.test.ts` + tool test suites
**Verified:** `pnpm test:coverage` — statements 81.34%, branches 78.55%, functions 76.25%, lines 81.04%, `COVERAGE EXIT=0`; `pnpm test:sidecar` from repo root `EXIT=0`; 378 passing / 1 skipped (was 317)

Coverage went 72.0/68.0/73.3/71.6 → **81.34/78.55/76.25/81.04**, and the gate now
actually runs: root `test:sidecar` is `lint && build && test:coverage`, not bare
`vitest run`. `src/tools` went 67.2% → **100%** statements/functions. Thresholds
were verified enforced by bumping one to 100.1 and watching it fail.

The global floor is 81 rather than higher for a stated reason: `cli.ts` is 0% and
*cannot* measure higher, because it runs in a child process the smoke test
spawns. Excluding it would hide it; letting its 300 zero lines sit in the global
number would buy ~15 points of slack everywhere. So per-directory floors pin each
area at its real value (`src/tools/**` 100/87/100/100, `src/utils/**` 95/91/96/95,
`src/bridge/**` 85/78/91/85). The reasoning is written into `vitest.config.ts`.

**SDK boundary got two tests, not one.** `sdkBoundary.test.ts` spawns the built
binary and speaks real MCP over stdio with the SDK's own `Client`;
`sdkRoundTrip.test.ts` uses `InMemoryTransport` to cover what only bites on a
*call* — `outputSchema` validation of `structuredContent`. The Inspector CLI was
**not** wired into CI: it fetches a ~300-package dev tool per run, and `@latest`
resolves to a broken 1.0.1 whose CLI fails to load. Equivalence was verified by
hand against `@modelcontextprotocol/inspector@0.16.8` — 7 tools listed, and
`browser.timeoutMs` now carries `minimum: 1, maximum: 12000` over the wire.

The file-size gate's `ROOTS` gained `vmark-mcp-server/src` (audit §4 — it was
invisible). Four pre-existing violators were baselined; comments were trimmed so
**no sidecar file grew** and two shrank.

`vmark-mcp-server/vitest.config.ts` declares 90/70/90/90; actual is
72/68/73/72 and it never runs, because `check:all` calls `test:sidecar` =
`vitest run` with no coverage flag. `cli.ts` — the entire SDK boundary — is at
0%, because the test client deliberately simulates the protocol.

**DoD:** the gate runs in `check:all` at a threshold the package actually meets
(ratchet up, never silently down), and one MCP Inspector CLI smoke test
exercises the real SDK path.

### WI-8 — Delete the legacy mockBridge and type-check `__tests__` (§4)

**Status:** DONE — 2026-07-28
**Changed:** deleted `__tests__/mocks/mockBridge.test.ts` (468 lines) and the 930-line mock, replaced by a 76-line `Bridge` double; new `tsconfig.test.json`; widened `lint`; untracked `__tests__/utils/McpTestClient.js{,.map}`; new `vmark-mcp-server/.gitignore`
**Verified:** `pnpm lint` (eslint src + `__tests__`, `tsc --noEmit -p tsconfig.test.json`) `EXIT=0`; 378 tests passing

Six live test files did import `MockBridge`, so rather than a clean delete the
surface they actually use was kept (`setResponseHandler`, `getRequestsOfType`,
`requests`) and the ~500-line pre-prune simulator plus the 12 non-existent type
imports were dropped. One behavioral improvement: an unstubbed request type now
**fails loudly** instead of returning a plausible empty success.

Type-checking `__tests__` for the first time surfaced **41 real errors**, all
fixed — 26 uses of pre-prune request types that are not in the `BridgeRequest`
union, 7 `JSON.parse(result.content[0].text)` sites passing `string | undefined`
(now a strict `toolText`/`toolJson` helper that throws rather than comparing
against `''`), and 3 union-narrowing errors. The test count dip from 317 to 276
mid-way was the deleted simulator tests; the end state is 378.

~1,300 lines simulating the pre-prune protocol, importing 12 types that do not
exist, invisible because `tsconfig.json:25` excludes `__tests__` and lint
covers only `src`.

**DoD:** the mock and its test are gone; `__tests__` is type-checked and
linted; sidecar tests green.

### WI-9 — Harden the WebSocket bridge (§2.2)

**Status:** DONE — 2026-07-28
**Changed:** `src-tauri/src/mcp_bridge/server.rs` (746 → 532), new `handshake.rs` (291), `connection.rs` (219), `token_file.rs` (163), `state.rs` (270) + their `.test.rs` siblings
**Verified:** `cargo test --lib` — `1576 passed; 0 failed` (30 new tests); `cargo clippy --all-targets -- -D warnings` clean; `cargo fmt --check` clean; `scripts/check-cross-target.sh` — Windows target compiles clean

All five controls landed, each RED-verified except constant-time compare (see
below). Origin: `accept_hdr_async_with_config` with `check_upgrade_request` —
**absent Origin allowed** (the sidecar sends none, verified), present-and-not-
allowlisted → 403, non-ASCII → rejected rather than mistaken for absent.
Constant-time compare uses SHA-256 + XOR-fold via `sha2`, already a direct
dependency, so no new crate. Caps: message 64→16 MiB, frame 16→4 MiB, read
buffer 128→16 KiB (all read-path, so screenshots are unaffected), plus a
32-connection RAII gauge acquired *before* the handshake. Pre-auth allocation
removed — no channel, no `clients` entry, no shutdown channel until the token
validates; the 100 ms flush-sleep hack went with it. Token file follows
Jupyter's `secure_write`: 0700 parent (best-effort), pre-tighten an existing
file so `preserve_target_permissions` carries 0600 forward, explicit 0600,
re-stat and **hard-fail**, and delete the file on failure so a refusing bridge
leaves no readable secret.

Also folded in the audit's §4 recommendation: the five copy-pasted pending-
cleanup blocks collapsed into `fail_pending()`, which is most of how `server.rs`
lost 214 lines.

**Honest limitations.** (1) Constant-time-ness is not test-provable — the token
tests pin correctness and all pass under the old `==` too; the property rests on
review, not a gate. (2) Two token-file tests pass against the old code because
`tempfile` accidentally produced 0600 for *new* files — which is precisely the
audit's point; the loosened-file and parent-dir cases are the ones that bite.
(3) Parent-dir 0700 is best-effort, not fatal, matching Jupyter: a group-readable
directory leaks the file's name, not the secret. The file's own mode is a hard
failure.

The Windows cross-check earned its keep: it caught `connection_test_lock` as dead
code in the Windows test build, which macOS-local cargo cannot see.

Add an `Origin` allowlist (absent header = non-browser client = allow, the
Chrome/Discord semantic), constant-time token comparison, message-size and
connection caps, no pre-auth `client_id`/channel allocation, and an
explicit-and-verified 0600 token file under a 0700 parent.

**DoD:** each control has a test; `cargo test` green; the sidecar still
connects end to end.

### WI-10 — Tool-quality pass (§3.3–3.4)

**Status:** DONE — 2026-07-28
**Changed:** all of `vmark-mcp-server/src/tools/*.ts`, `cli.ts`, `types.ts`; new `src/utils/toolOutput.ts`, new `src/utils/toolSchema.ts`; **deleted** `src/utils/jsonSchemaToZod.ts` + its test
**Verified:** 378 tests passing; `outputSchema`/`structuredContent` covered by `sdkRoundTrip.test.ts`; schema bounds confirmed over the wire via Inspector

All four sub-items landed, including the Zod-first migration that was flagged as
droppable. `jsonSchemaToZod` (156 lines) is gone: `ToolDefinition.inputSchema` is
now a Zod raw shape handed straight to `registerTool`, and `toolSchema.ts`
derives JSON Schema *from* Zod for the internal registry — the inverted pipeline
is corrected. The audit's live loss is fixed (`browser.timeoutMs` bounds now
reach clients) and three further dropped keywords (`pattern`, `maxLength`,
`minLength`) now survive too.

Truncation caps output at 25,000 tokens with seven per-surface recovery hints.
The `document.read` message is the load-bearing one — it tells the agent not to
retry unchanged and, critically, **not to write back from a truncated read**,
because the unread remainder would be destroyed. When truncated,
`structuredContent` is replaced by a notice rather than mirroring the full
structure, since clients feed structuredContent to the model too.

**The composite-tool tension, recorded rather than hidden.** An `action`-enum
tool cannot be `readOnlyHint: true` for `document.read` and
`destructiveHint: true` for `document.write`. Every tool therefore declares the
most dangerous accurate value: only `session` is read-only; the other six all
declare `readOnlyHint: false, destructiveHint: true`. The sharpest case is
`coherence`, where 4 of 5 actions are pure reads but `resolve` writes a
non-undoable ledger entry. Splitting the read-only actions into separate tools is
the only real fix, and that changes the surface shape, which this plan's
non-goals rule out. `outputSchema` was added only to `document` and `session` —
the other five have shapes too unstable to risk, because the SDK turns a
*successful* call into a protocol error if the payload fails validation.

Add `annotations` and `title` to all 7 tools; `outputSchema` +
`structuredContent` where shapes are stable; output truncation with a steering
message; author schemas in Zod directly so the lossy `jsonSchemaToZod`
converter can be deleted.

**DoD:** every tool declares honest annotations; `browser.timeoutMs` bounds
reach the client-visible schema; sidecar tests green.

## Audit-fix round 1 (independent Codex review, 2026-07-28)

`gpt-5.6-sol` at high effort, read-only, five module-coherent groups over the
remediation diff. It found real defects in the work above — including one the
original audit and WI-1 both missed.

**Note:** `.cc-suite.md` pinned `gpt-5.3-codex`, which this ChatGPT account no
longer supports; every Codex call hard-failed until the model was corrected.

### Frontend (fixed here)

| Finding | Severity | Resolution |
|---|---|---|
| `document.ts:142` — **`loadContent` never bumped the revision.** WI-1 fixed `setContent`; the external-reload and hot-exit-restore path had the identical bug, and `workspace.open` was compensating for it at exactly one call site | High | Both writers now route through one `bumpRevisionIfContentChanged` primitive — one definition is what stops them drifting apart again. 3 tests |
| `workspace.ts:119` — only `isDirty` protected the buffer; an **`isDivergent` doc is clean** but holds content the user deliberately kept after "Keep my changes", and reopening replaced it | High | Divergent now counts as unsaved; the refusal reason distinguishes the two cases. Test added |
| `workspace.ts:138` — reloading a clean tab via `initDocument` rebuilt the entry, **silently clearing `readOnly`** and leaving `documentId` at 0 for a first-open doc so the editor might never remount | High | Reload now uses `loadContent`, which mutates in place and increments `documentId`. 2 tests |
| `browserPower.ts:167,202` — `MAX_SCRIPT_BYTES` names **bytes** but was enforced with `String.length` (UTF-16 code units), so a CJK payload passed at ~3× the cap. Found by the sidecar agent in its own file and reported across the boundary | Medium | `utf8ByteLength` via `TextEncoder`. 4 tests, incl. a fixture asserting it is under the cap in code units and over it in bytes. **Note: the Rust `browser_eval` command has no cap at all — these two gates are the only ones** |

### Sidecar (fixed by agent)

Surrogate-safe truncation (cuts on UTF-8 code-point boundaries, drops a trailing
ZWJ so a cut never lands mid-emoji-sequence; every byte offset tested for CJK,
emoji, combining marks, RTL); one `TruncationEnvelope` serialized into **both**
the text block and `structuredContent` so the channels can't disagree; the
25,000-token cap actually enforced as a UTF-8 byte bound with the notice paid
for *inside* the budget; blank/garbled `tabId` rejected at both the schema and
handler layers across all five tools (`""` previously fell through to the
focused tab — a wrong-document write); byte-accurate script cap; invalid
`profile` refused instead of silently opening an anonymous tab; honest recovery
hints for `session.get_state` and `browser.console` (the old console hint sold
`clear: true`, which returns the same oversized response and then destroys the
unseen remainder). `current_revision` on STALE is now surfaced as structured
content rather than deleted. Coverage ratcheted **up** to 83/80/78/82; tests
378 → 443.

**One finding rejected, with reasoning recorded in the code:** per-action
`outputSchema` envelopes. MCP gives a tool one output schema, the payload
carries no action discriminant, and a failed output validation turns a
*successful, already-committed* write into a protocol error. Schema tidiness is
not worth reporting a completed disk write as a failure.

### Bridge (fixed by agent)

+38 tests. RED captured first (24 compile-level failures naming each missing
behaviour), then **six mutation checks** — each fix was re-broken and the
guarding test confirmed to fail. `handshake.rs` would have crossed 300 lines, so
the three pre-auth wire frames moved to a new `frames.rs` (67).

| Finding | Severity | Resolution |
|---|---|---|
| `token_file.rs` — the secure write went through an atomic writer that **preserves target permissions**, so a 0644 target could hand its mode to the new token before the post-write chmod | High | `write_secured()` stages into a temp file, sets **and re-stats** 0600, and only then persists. Target permissions are never consulted; `tighten_existing_file()` deleted as obsolete |
| Cleanup failure after a permission error was silently discarded, leaving a readable token | High | `abandon_unprotected_token()` reports the cleanup failure alongside its cause, naming the file to delete by hand |
| Parent-dir 0700 was best-effort and never verified | High | `enforce_mode` chmods **and re-stats**; kept non-fatal (a loose directory leaks the file's *name*, not the secret; the file's own verified 0600 is the gate) with the reasoning in-code |
| **The connection cap did not bound pre-auth allocation** — the slot was taken *inside* the spawned task, so the accept loop could pile up tasks, cloned `AppHandle`s and sockets before any of them acquired one | High | `admit_connection()` takes the slot **synchronously in the accept loop**; `handle_connection` now requires a `ConnectionSlot` **by value**, so "task without a slot" is unrepresentable. Nothing is cloned before the slot is held. Test: 40 concurrent dials → exactly 32 admitted, 8 refused, peak ≤ 32 |
| 16 MiB pre-auth frame limit — 32 peers × 16 MiB of retainable memory | High | Confirmed tokio-tungstenite 0.30 exposes `get_config` but **no** `set_config`, so the transport cap genuinely cannot be raised post-auth; enforced a 64 KiB application-layer cap before parsing, with compile-time bounds assertions. *Caveat: tungstenite has already buffered the frame, so this bounds retention and repetition, not single-frame peak* |
| A panic after client registration leaked the map entry and the detached writer task | High | `unregister_after()` wraps the authenticated phase in `catch_unwind` and **always** removes the client and aborts the writer. Doc explains why this can't be a `Drop` impl (removal needs the async lock) |
| Two remove-unlock-send blocks in `routing.rs` still duplicated `fail_pending()` | High | Helper moved to `delivery.rs` as `pub(super)`; both sites call it |
| Write guard held across `deliver_response().await` despite a comment claiming otherwise | Medium | `without_write_lock(guard, deliver)` drops it before awaiting — type-enforced, not comment-enforced. The test observes the ordering by reading the lock inside the delivery future |
| `authenticated_principal` is a false name for a caller assertion | Medium | Renamed `asserted_principal`; doc leads with why the old name was wrong ("a warning comment does not survive autocomplete") |
| Stale module docs in `state.rs` and `coherence_answers.rs` | Low | Both corrected |

**Second finding rejected, with a better technical argument than the audit's.**
The audit wanted `subtle::ConstantTimeEq` for token comparison. The agent
declined and showed the reasoning is wrong: `subtle`'s `ConstantTimeEq for [T]`
**short-circuits on a length mismatch**, so on raw tokens it is no better than
what exists, and on two SHA-256 digests it is behaviourally identical to the
current fold. The audit's premise — "hashing runtime scales with input length"
— is true but not a leak, because the only variable-length input is the
*attacker's own*, whose length they already know; `expected` is a fixed 64 hex
chars and SHA-256 is data-independent in timing. It did implement the fallback:
a length check first, documented as **work-bounding, explicitly not claimed as
a timing fix**, and safe to short-circuit because the expected length is a
compile-time constant rather than a secret.

**Residual gap stated honestly:** the non-fatal parent-dir wiring (write
succeeds despite a hardening error) has no test — a chmod failure on a directory
we own could not be induced portably without `chflags` or root. The `Err` branch
is unit-tested and the policy is a single visible `log::warn!`.

### `mcp_config` (fixed by agent)

Tests 23 → **66**. The module was re-cut into `config_io.rs` 237 (content),
`install_io.rs` 227 (workflow), `backup_io.rs` 167, `vmark_entry.rs` 121,
`commands.rs` 175 — all under the limit, and `commands.rs` no longer touches the
filesystem at all.

| Finding | Severity | Resolution |
|---|---|---|
| Backups created with default permissions — a `0600` config became a `0644` backup | High | Source mode passed to `open(2)` via `OpenOptionsExt::mode`, then re-applied because `open(2)` masks against umask, so the file is never *momentarily* wider than its source |
| Backup never flushed or fsynced before the original was replaced — a crash could leave a durable new config beside a truncated backup | High | `write_all → flush → sync_all → sync_parent_dir` before the replace. Parent-dir fsync is best-effort and logged (it legitimately fails on some filesystems, is impossible on Windows, and the bytes are already durable). `fsync` isn't unit-observable, so tests pin the truncation proxy |
| Install replaced the **entire** `vmark` entry, discarding user-set `env`/`args` | High | `vmark_entry.rs` upserts: we own `command` and the legacy `--port <n>` pair, nothing else. RED was real — first run printed `user env must survive / left: Null / right: "1"` |
| Backup-collision test depended on five calls landing in the same wall-clock second, so it could pass against the old clobbering code | High | Clock removed from the test path; base name injected. Exhaustion test pre-creates all 100 variants and asserts every one survives byte-for-byte; 8 barrier-synced threads cover concurrency |
| Uninstall was only tested against the pure parser, never the filesystem guarantee | High | `uninstall_config_at` extracted; malformed JSON/TOML now proven to make no backup and leave the file untouched |
| Read→validate→backup→write TOCTOU | Medium | Bounded CAS/retry: re-read and compare before replacing, and **retry the whole merge against the new content** (3 attempts) rather than erroring — Claude Code rewrites `~/.claude.json` often enough that a hard error would be routine |
| Uninstall duplicated the install workflow and had already drifted | Medium | One `mutate_config_at(path, transform)`; both are four-line wrappers. Two wins fell out: an identical re-install now writes nothing (Repair stops littering backups), and uninstalling when not installed leaves the file byte-identical instead of re-serialising it |
| Provider→format dispatch copy-pasted across four functions | Medium | One `ConfigFormat` + `config_format()`; a test iterates `PROVIDERS` so a new provider cannot be added without a format |

**A bug the agent introduced and caught itself:** switching the fresh-create
path from `atomic_write_file` to `create_new` silently changed a brand-new
`~/.codex/config.toml` from 0600 (what `NamedTempFile` + rename produced) to
0644 under umask 022. Fixed with an explicit `FRESH_CONFIG_MODE` and pinned by
a test.

## Round-1 verification (independent, 2026-07-28)

A separate read-only Codex pass checked each claimed fix rather than trusting
the implementers' self-reports. **20 FIXED, 5 PARTIAL, 2 REGRESSED.** The two
regressions were real breakage introduced by round 1 and are fixed here.

### REGRESSED — fixed immediately

| Regression | Cause | Fix |
|---|---|---|
| `scripts/check-coherence-phase.sh:536` asserted the symbol `authenticated_principal`, which WI-6's rename removed — so the phase-1 gate would fail | The rename was correct; the gate wasn't updated with it | Gate now asserts `asserted_principal`, with a comment recording why the symbol changed. Verified: `check-coherence-phase.sh 1` → **50 passed, 0 failed** |
| `workspace.open`'s new `loadContent` reload path dropped the `clearMissing` that every other disk-reload site pairs with it, so a deleted-then-recreated file stayed flagged missing forever | Switching from `initDocument` (which rebuilt the entry, incidentally clearing the flag) to `loadContent` (which deliberately doesn't) | Paired them exactly as `services/persistence/reloadFromDisk.ts` does. `loadContent` was deliberately **not** changed globally — hot-exit restore replays saved content for a file that may genuinely be gone. Test added |

### Both round-1 pushbacks were ruled on — and both were over-claimed

The verifier was asked to judge the two findings the implementers rejected.
Neither rejection was overturned, but **both arguments were too strong** and the
code comments have to say less than they did.

- **`subtle::ConstantTimeEq`** — our points (a) subtle's slice compare
  short-circuits on length, and (c) a wrong-length attacker token leaks nothing,
  both stand. Point (b), that our SHA-256 + XOR fold is *behaviourally
  identical*, is true only **algorithmically**: subtle applies `Choice`
  optimization barriers throughout, whereas we apply `std::hint::black_box`
  once after the reduction — and Rust documents `black_box` as giving **no**
  cryptographic guarantee. Verdict: defensible best-effort, but claiming
  equivalent hardening is unjustified. Comment being corrected in round 2.
- **Per-action `outputSchema`** — the post-commit validation risk is real and
  decisive, but "not expressible" was too strong: an `{action, result}` object
  envelope with a nested discriminated union *is* expressible, and the
  2026-07-28 revision adds full JSON Schema composition. The decision stands on
  the validation risk alone; the reasoning must not rest on impossibility.

### PARTIAL — carried into round 2

`token_file` parent-directory hardening (the verifier's threat model is sharper
than ours: a group/world-**writable** directory permits token **replacement**
and sidecar redirection, not merely filename disclosure — so writable must be
fatal even if readable stays a warning); the 64 KiB pre-auth cap bounds
retention but not single-frame peak, because tungstenite has already assembled
the message under the transport cap (accepted and documented); `mcp_config`
fresh-create lost its failure-atomicity when it gained no-clobber semantics; the
CAS window is narrowed but the backup step still sits between comparison and
rename; a pre-existing empty `args: []` is removed although it holds no legacy
`--port` pair; `coherence_answers.rs` still calls `edges` read-only.

**Verifier caveat:** it ran read-only, so Cargo and Vite could not open their
build locks — every verdict is from source inspection, not execution. The
executable evidence is the local gates, which are green.

## Audit-fix round 2 (2026-07-28)

Targeted the items round-1 verification left PARTIAL or REGRESSED, rather than
re-sweeping ground already covered.

### Bridge

**Writable parent directory is now fatal.** The implementer agreed with the
verifier without reservation, and named the confusion in round 1's reasoning
precisely: *a 0600 file mode stops another user reading our file; it does
nothing to stop them replacing it.* On a group/world-writable directory an
attacker unlinks the token and drops in their own — the sidecar then
authenticates to **their** endpoint, or hands them a token we write later. That
is authority transfer, not name disclosure.

Policy extracted to `token_dir.rs` (147 lines — `token_file.rs` would otherwise
have hit 342, over the gate). `classify_dir_mode` is pure over an observed
mode: `mode & 0o022` → refuse, naming the directory, its mode, and `chmod 700`;
exactly `0o700` → secured; anything else → warn and continue (name disclosure
only). The verdict comes from a **re-stat**, never from the chmod's return, and
a directory whose mode cannot be read at all is an error — unknown is not safe.
The guard runs *before* `write_secured`, so a refusal means the token never
reaches disk, and the error propagates out of `start_bridge` so the bridge does
not start.

Two judgement calls worth recording. The case that matters — a directory this
process cannot chmod — needs root to create, so the end-to-end tests use a
`#[cfg(all(unix, test))]` thread-local seam compiled out of every non-test
build; the alternative of pointing a test at `/tmp` was rejected because a
root CI run would chmod `/tmp` to 0700. And sticky+writable directories are
*not* exempted despite sticky genuinely blocking unlink-of-another's-file: our
app-data directory is never sticky, and a mode-dependent exemption is more
subtlety than the case earns.

**Comment corrected, no dependency added.** `handshake.rs` now separates what
the construction does from what it is not: `black_box` is a language hint that
guarantees nothing, is not a cryptographic primitive, and is applied once after
the reduction rather than throughout; `subtle::ConstantTimeEq` keeps `Choice`
barriers across the whole comparison and is the strictly stronger option if
this token ever guards something remotely reachable. Header changed from
"Constant-time" to "Best-effort constant-time".

**Docs.** `coherence_answers.rs` now states plainly that three operations are
pure reads and **two write** (`edges` appends provenance via `scan_workspace`;
`resolve` writes a receipt), verified against the code. Two further defects
were found in passing: `answer_coherence`'s doc comment had been glued onto
`is_known_workspace`, leaving `answer_coherence` with no documentation at all,
and the same fusion had happened in `routing.rs`, where the surviving text
claimed the write lock is taken "for `edges`" when the code also takes it for
`resolve`.

Verified: `cargo test --lib` **1657 passed**, clippy clean, fmt clean, Windows
cross-target clean, file-size gate clean.

### `mcp_config`

**Fresh create is failure-atomic again *and* still no-clobber.** Round 1 traded
one property for the other; round 2 keeps both. New `create_io.rs` (131 lines)
stages into a `NamedTempFile` in the destination's own directory, pins 0600 on
the staged file, `write_all → flush → sync_all`, then `fs::hard_link`s it into
place. `link(2)`/`CreateHardLinkW` returns `AlreadyExists` rather than
replacing, so no-clobber survives, while the bytes are complete and fsynced
*before the destination exists at all*. The 0600 pin now rides the inode rather
than depending on umask. `NamedTempFile`'s `Drop` unlinks the partial on every
error path.

The RED here was initially just a missing-module compile error, which is weak
evidence — so the implementer additionally ran a **mutation check**, reordering
the function to link-before-write (round 1's shape) and confirming the test
failed with its own message (*"the destination must be absent, never partial"*).

**The CAS window is narrowed and honestly bounded.** Reordered from
check→backup→rename to **backup→check→rename**, so nothing separates the
comparison from the write. A losing attempt now discards the backup it already
took, or a retried mutation would litter the user's home with copies of content
it never replaced. The residual one-read-then-rename gap is **documented in-code
as irreducible** rather than papered over: closing it needs a lock the *other*
writers honour, and Claude Code, Codex CLI and Gemini CLI take none — POSIX
advisory locks and `LockFileEx` only exclude participants.

**Empty `args: []` survives.** The bug was asking "did the list end up empty?"
instead of "did *we* empty it?". `strip_legacy_port_args` now returns early when
no legacy pair is present, so a list we never touched is never a removal
candidate — and JSON and TOML share the rule instead of duplicating 18 lines
each. RED was behavioural: `left: None, right: Some(Array [])`.

**i18n: correctly declined.** The implementer verified empirically rather than
assuming — appended a probe key to `en.yml` and watched `pnpm lint:i18n` fail
across all nine locales (`checkYamlLocales` has no "translation not started"
skip, unlike the JSON path). Scale is ~30 strings × 10 locales ≈ 300 machine
translations into files this repo has a dedicated `translate-docs` skill and
proofreading workflow for. It also flagged the real design question that pass
must answer first: many of these are developer diagnostics with untranslatable
payloads (`"Invalid JSON: {serde_error}"`), where translating the wrapper is
cosmetic — so the pass needs to triage user-actionable messages from
diagnostics before translating anything.

**The hard-link dependency was then removed as a failure mode** (follow-up,
same day). Round 2 originally let a filesystem without hard links fail the
install outright, justified as "a loud named failure beats an untestable
fallback". Two of those three premises did not survive review:

- **exFAT was the wrong culprit.** `set_permissions` runs before the link, so
  an exFAT home fails earlier and elsewhere with a different message. The real
  case is a network or FUSE-mounted home — SMB with links disabled server-side,
  sshfs, a cloud-sync layer.
- **"Untestable" had already been disproved in the same function.** The
  `StageWrite` seam existed precisely to inject a failure no filesystem hands
  out on demand; a symmetric `LinkFn` makes the fallback equally testable.

So the cascade is now: hard-link (atomic + no-clobber) → on any
non-`AlreadyExists` link error, `create_in_place` (no-clobber via `create_new`,
atomicity given up, `log::warn!` recording the degradation). The ordering is
explicit in the module doc: **no-clobber is never traded; atomicity is traded
only when the filesystem leaves no alternative** — and only on this path, which
by definition creates a file that did not exist, so the risk is a truncated
*new* config rather than destruction of an existing one. The degraded path
removes the partial file on any error it observes; only a hard crash can strand
one. Both routes set 0600 at creation, so neither leaves a wider-mode window.

A blanket fallback on any non-`AlreadyExists` error is deliberate and
self-correcting: if the underlying cause is real (permissions, ENOSPC), the
fallback fails too and the error names **both** failures rather than only the
second.

5 new tests, each mutation-checked. Two mutations were run: reverting to
refuse-on-link-failure fails 3 tests; skipping the partial-file cleanup fails
the 4th. That second check mattered — the cleanup test originally routed
through `create_new_config_via` with a failing writer, which fails during
*staging* and never reaches the fallback at all, so it was re-testing staging
cleanup and proving nothing. It now calls `create_in_place` directly.

Verified: `cargo test --lib` **1662 passed**, clippy clean, fmt clean, Windows
cross-target clean, `create_io.rs` 248 lines.

## Outstanding — deliberately not done

Each was ruled out of a WI's scope, not overlooked. Ordered by value.

### Closed after round 2

**`serde_json` `preserve_order` — DONE.** Every install parsed and
re-serialised `~/.claude.json` through a `BTreeMap`, alphabetising every key at
every nesting level: a whole-file diff on a config people keep in dotfile repos,
burying the one line that actually changed. Nested objects were hit too — a
sibling server's `command`/`args`/`env` got shuffled, and even individual `env`
var names were sorted.

The reason this was deferred rather than done immediately was cargo's feature
unification: enabling it changes `serde_json::Map` for the **whole crate**,
including Tauri's own IPC serialisation. That was checked before enabling rather
than assumed —

- nothing in `src-tauri/` iterates a `serde_json::Map` expecting sorted keys;
- every test touching serialised JSON uses `contains()`, a parse-back round
  trip, or compares two serialisations *to each other* (so both sides move
  together) — none assert an order;
- JSON object key order carries no semantics for any consumer here.

**Dependency cost turned out to be zero crates.** `indexmap` was already in the
build via `reqwest` → `h2` and via `plist`; the `Cargo.lock` delta is a single
line adding the feature edge. Verified with `cargo tree -e normal -i
indexmap@2.14.0`.

RED first: both new tests failed against `BTreeMap`, including the nested-`env`
case. `cargo test --lib` **1664 passed** with the crate-wide feature on.

### `mcp_config` i18n — DONE

**27 new `errors.mcp.*` keys across all ten locales**, hand-translated against
each file's existing `errors.pandoc.*` register (fr keeps its space before
punctuation; zh/ja use full-width forms; provider terminology taken from the
matching React locale). Only one structural change to the code: `backup_io.rs`'s
`Failed to {stage} backup …` became **three keys** rather than interpolating
`%{stage}` — an English verb dropped into the middle of a German or Japanese
sentence is not a translation. Every other site is a mechanical `format!` → `t!`
swap.

**No test needed changing.** Every assertion on English error text still passes
because the `en` rendering is byte-identical to the old `format!` — and those
passing tests double as runtime proof that the keys resolve and interpolation
works.

Deliberately left English: `log::warn!` messages (they go to the log, not the
user — `pandoc/run.rs` translates only what it returns as `Err`), path/name
building, and `*.test.rs`.

**Incidental find:** `errors.mcp.spawnInProgress` exists in all ten locales with
**zero** Rust call sites. Pre-existing dead key, left alone.

### The Integrations panel showed five English strings — DONE

The i18n pass surfaced a gap in its own brief: `commands.rs`'s status and result
messages are non-error `format!` calls, so they were out of scope — but
`McpConfigInstaller.tsx` renders them **verbatim**, so the settings panel showed
English regardless of UI language.

**Fixed on the React side, not with Rust `t!()`**, because the text carries no
information the frontend lacks. `DiagnosticStatus` is a serialized four-variant
enum the component **already switches on** (`status === "PathMismatch"` gates the
Repair button), so the message is a pure function of data already in hand.
Translating it in Rust would mean maintaining ten locale entries for derivable
text, in the process that does *not* own the UI language.

The decisive precedent was in the same file: the repair path already did
`setSuccessMessage(t("integrations.installMcp.repairSuccess"))` instead of
echoing `result.message`. The other four call sites were simply inconsistent
with it.

One backend change was genuinely needed: `UninstallResult` carried only
`success` + prose, so "removed" versus "nothing to remove" was **not**
derivable. Added `changed: bool` — the machine-readable signal the sentence
already encoded.

5 new keys × 10 React locales, real translations (not English placeholders),
inserted beside their siblings — 50 insertions, zero reformatting. `diagnostic.
message` is kept as the fallback for an unrecognised status, so the UI still
says *something* if the enum ever grows.

**Finding worth acting on separately: `pnpm lint:i18n` cannot see untranslated
values.** It checks key *presence*. Measured across `src/locales/*/settings.json`,
**45–49 values per locale (~7%) are byte-identical to English** — including
`installMcp.previewTitle` and `installMcp.safetyNew`, which sit directly beside
the keys added here. The gate is green and always has been. A value-level check
(flag non-en values identical to en, with an allow-list for legitimately
identical strings like product names) would catch this class.

### Per-client credentials — DONE (the WI-6 mechanism, finally fixed)

WI-6 corrected the *comment*; this replaces the mechanism. The principal is now
fixed at auth time from a credential VMark mints and verifies. `identify` is
informational only and `asserted_principal` is deleted.

**Why it mattered** wasn't privilege escalation — a same-UID process already has
full tool access. It was that **the ledger receipt was forgeable**: attribution
anyone can claim is worse than none, because it is trusted.

`mcp_config_install` writes `env.VMARK_MCP_TOKEN` into the provider's own entry,
merging into the user's `env` rather than replacing it. **The configs are the
token store** — no keychain, no new persistent state, no stored-secret migration.

**One deviation from the brief, and it is an improvement.** I specified one token
doing both jobs; the implementer split them — `token` (access, unchanged) plus
optional `client_token` (identity). Under the single-token design, a stale,
hand-edited, or unparseable credential means **auth is rejected and that client
loses every VMark tool**. The brief required "never let a broken third-party
config prevent VMark starting"; single-token honours that at startup and then
violates its spirit one step later, at the connection. Splitting collapses every
failure mode — migration, rotation, hand-edit, unparseable config — into one
behaviour with one remedy: the client connects and works normally, and only
`coherence.resolve` is refused, with an actionable message.

| State | Connection | Other tools | `coherence.resolve` |
|---|---|---|---|
| Existing install (no credential) | succeeds | unaffected | `principalMissing` |
| Rotated / hand-edited / config unparseable | succeeds | unaffected | `principalUnknown` |
| Same credential in two configs | succeeds | unaffected | `principalAmbiguous` — names both |
| Installed via new code | succeeds | unaffected | authorized as that provider |

Two further judgement calls: **Install preserves an existing credential** rather
than minting on every Repair (Repair is a routine click; rotating on it would
silently unidentify a running sidecar) — deliberate rotation is Uninstall →
Install. And the **preview renders `<generated on install>`** rather than a real
token, with that literal treated as absent, so a user who copies the preview
cannot end up using it as a credential or sharing one.

**Mutation-checked.** Reverting the principal to `identity.name`:
`identify_cannot_promote_an_unidentified_client_to_a_provider` →
`left: Provider("codex-cli"), right: Anonymous`, and the cross-provider variant
likewise. Both pass restored.

Found in passing: a latent `toml_edit` **panic** — a standard `[mcp_servers]`
holding an inline `vmark = {…}` would have had `Item::Table` inserted into an
`InlineTable`. `TomlEntryStyle` is now asked of the entry, not the parent.

The Windows cross-check earned its keep again, catching a non-gated test using a
Windows-gated import that the macOS build could not see.

`cargo test --lib` **1762 passed**; sidecar 432 passed; `cli.ts` 317 → 269 and
**no sidecar file is baselined any more** (four were at session start).

**A gate bug I introduced and fixed:** the phase-3 assertion grepped for the bare
string `asserted_principal`, which a *historical comment* in `state.rs`
explaining why the symbol was replaced legitimately trips. A gate that forbids
naming a defect in the comment documenting that defect buys its assertion by
deleting the reason for it. Now matched as `fn asserted_principal|
asserted_principal *\(` — verified both ways: passes with the comment present,
fails when a real definition is injected.

### `diagnose` now distinguishes "broken" from "not installed" — DONE

`read_existing_config` returned `(Option<String>, bool)`, where a missing file
and a corrupt one both yielded `has_vmark == false`. So a malformed
`~/.claude.json` was reported as `NotConfigured` — the panel said **"not
installed"** when the truth was **"your file is broken"**, and then offered
Install, walking the user into a path the hardened install correctly refuses.

New `ExistingConfig` enum with three states (`Absent` / `Parsed` /
`Unreadable`), plus a `ConfigUnreadable` diagnostic variant. The
absent-vs-unreadable decision is **delegated to the install path's own
`read_config_for_merge`** rather than re-implemented — one place decides, so the
two cannot drift, which is the bug class being fixed.

**An edge case that would have been a regression, caught by writing the RED test
first:** a blank config is not valid JSON, but `generate_config_content`
deliberately builds on it (pinned by the pre-existing
`empty_config_file_is_treated_as_fresh`). Naive parsing would have reported
those users as broken and denied them Install. Blank content now routes through
the same `merge_base` predicate the install path uses.

`extract_vmark_binary_path` was **deleted** — it re-parsed the entire file (all
of Claude Code's state) purely to pull `command` back out, duplicating the parse
that had just happened. `ExistingConfig::Parsed` carries `binary_path` from the
single parse.

The UI withholds Install/Update/Remove/Repair for an unreadable config and
offers **Recheck** instead, because `hasVmark: false` there means *unknown*, not
*no*. The button decision moved into a pure, tested `rowActions()`.
`McpConfigInstaller.tsx` went **316 → 299** and its baseline was ratcheted down.

**No new Rust locale keys were needed** — the detail strings (`mcp.invalidJson`,
`mcp.invalidToml`, `mcp.readFailed`) already exist and are already localized, so
Rust returns data plus a localized reason and React composes the sentence. Two
React keys added across all ten locales, hand-translated.

`commands.rs` had **zero** tests before; it now has 9, because `build_diagnostic`
was extracted as a pure function and the status mapping became reachable.
`config_exists` now derives from the read result instead of a separate
`path.exists()` stat, closing a TOCTOU window as a side effect.

`website/guide/mcp-setup.md`'s Status Icons table gained the new row (rule 21);
website build verified.

### The i18n gate now checks values, not just keys — DONE

`lint:i18n` proved a key *exists* in every locale. It could not tell whether
anyone translated it, so a key copied over with its English value passed
silently — and **1,167 of them had**.

The heuristic is the whole design. Of ~3,000 values byte-identical to English,
most are *supposed* to be: `JSON`, `YAML`, `CLI`, `Markdown`, `TypeScript`,
`VMark`. A naive equality check would be ~90% false positives and would train
people to edit the baseline instead of the translation. Requiring **≥3 words and
≥15 characters** keeps proper nouns, format names and acronyms out while still
catching real sentences like "Application title bar". Deliberately conservative:
a missed untranslated string is cosmetic, a false positive corrodes the gate.

Implemented inside `scripts/check-i18n-keys.ts` rather than as a second script,
reusing its existing flatteners (a `flattenYamlValues` was added alongside
`flattenYaml`, which returns keys only). Covers **both** locale systems.

`scripts/i18n-untranslated-baseline.json` freezes the debt at 1,167 entries and
**ratchets down only** — matching `file-size-baseline.json`. A new
English-looking value fails with the exact key; a baselined entry that has since
been translated also fails, telling you to record the win with
`pnpm lint:i18n --update-untranslated`.

**Both directions were proved, not assumed:** copying an English value into
`de/settings.json` failed with that exact key named, and injecting a stale
baseline entry failed with the update instruction. Restoring each returned the
gate to green.

Scale note: the earlier "45–49 per locale (~7%)" figure was `settings.json`
only. Across all namespaces it is **~129 per locale**. The Rust YAML side is
effectively clean — 3 entries, all `Rich Text (.rtf)…`, a format name that
plausibly stays English.

Documented in `AGENTS.md` beside the existing i18n rule.

### Sidecar cleanup — DONE

**Dead exports gone.** All eight were verified unreferenced before deletion (only
each other, the `index.ts` re-export, and one test). `server.ts` **302 → 160
lines**, coverage **62.5/51.0/70.8/60.7 → 100/90.5/100/100**. Two adjacent finds:
`ToolArgs` *is* used, so it moved to `tools/toolArgs.ts` where argument handling
now lives; `WindowId` was the return type of the two deleted `windowId` helpers
and nothing else — the last vestige of a concept the live surface replaced with
`tabId`/`windowLabel`.

**The false `resources` capability is gone end to end.** Advertising
`resources: {}` while registering none tells every client that `resources/list`
and `resources/read` exist on a server that answers neither. Registering
something real was rejected as re-expanding a surface `20260504-mcp-pruning.md`
deliberately pruned — and `session.get_state` already returns in one round-trip
what the deleted `vmark://` URIs provided. Removed: the capability, the
always-empty registration loop, `RESOURCES`, the registry and its four methods,
three types, and two adapter functions.

**One cross-package contract deliberately preserved:** `--health-check` still
emits `resourceCount`, now literally `0`, because `useMcpHealthCheck.ts:25`
declares it **required** and `IntegrationsSettings.tsx:210` renders it. Verified
live — the field is present with value 0 and `toolCount: 7`.

**README rewritten against source**, not patched. All six audit items confirmed
and fixed, plus: browser documented as 5 actions (**13**), no CLI-flags section,
no output-bound section, stale config defaults, and a "Quick start" that
constructed a bridge which cannot connect to a real VMark. Two source comments
that contradicted their own code were fixed too (`websocket.ts:55` claiming a
`localhost` default against `'127.0.0.1'`; `index.ts` inline action counts still
reading 7/5/2).

**`selection.set` got `outputSchema`** after judging it against `document.ts`'s
recorded objection. That objection is about schema *strictness* — a strict schema
turns a completed write into an `McpError` — not about declaring one at all;
`document`'s own schema is fully permissive so it cannot fire. `selection` clears
the same bar and one extra check: `set` returns two flat scalars, and the only
nested object (`range`) appears **only on `get`**, a pure read where a false
rejection costs a retry rather than an edit. STALE handling moved to a shared
`staleError.ts` parameterised by the recovery action, and is proven to reach a
client both through the real SDK over `InMemoryTransport` and through a spawned
`dist/cli.js` over stdio.

**Coverage ratcheted up:** global 83/80/78/82 → **85/83/82/85**; `src/utils/**`
96/93/96/96 → **100/99/100/100**. Worth recording *why* the second number moved:
deleting well-covered code (`toMcpContents`, `createResourceHandler`) shrank the
denominator and pushed `src/utils` branch coverage **down** (93.1 → 92.72),
failing its own floor. The response was to close the real gaps in `portFile.ts`
— the three non-darwin `getAppDataDir` arms, the `VMARK_DEBUG` error path, the
default no-op `warn` — rather than lower the threshold.

`server.ts` left the file-size baseline entirely; `cli.ts` 322 → 317 (it briefly
grew to 325 from new comments, which were trimmed rather than the number raised).

Test count 443 → 415: ~35 resource-pipeline and `resolveWindowId` tests went with
the code they tested, offset by 21 new ones. Also removed `McpTestClient.ts` and
its self-test (~17 KB) — a harness whose only consumer was itself, and the last
thing keeping the resource types alive.

Follow-up handled here: `shapeToJsonSchema` was exported but used only inside its
own file and never re-exported; the keyword is dropped and knip's warning is
clear.

### `toml_edit` for the Codex config — DONE

The other half of the reordering bug, and the worse half. `~/.claude.json` is
machine-managed state, so `preserve_order` was enough. `~/.codex/config.toml` is
a file users **hand-write and hand-comment**, and the
`toml::Table` → `to_string_pretty` round trip destroyed every comment on every
install and every Repair click. No serde feature can give a comment back; only a
document model that keeps the original spans can.

**Dependency review (governance §4).** Same repository as `toml`
(`github.com/toml-rs/toml`), same owner team, first published 2017, 695M
all-time downloads. The 0.25 line matches our `toml = "1.1"` generation — both
carry `+spec-1.1.0` and share `toml_parser`/`toml_datetime`/`winnow`. Default
features only; `serde` deliberately off.

**Correction to my premise, in the project's favour.** I checked that `toml 1.1`
does not pull `toml_edit` and concluded this was a genuinely new crate. It was
already in the lockfile twice — `0.25.12` via `proc-macro-crate` → `ndk`
(Android), and `0.22.27` via `rust-i18n`'s proc-macro, which *is* on the macOS
target. Net lockfile effect: **three lines, zero new `[[package]]` entries**,
and `scripts/check-new-deps.sh` reports clean.

19 new/changed TOML tests, 9 RED first. The two that prove the feature:
`toml_changing_only_the_command_touches_exactly_one_line` (zip-diffs the
before/after and requires exactly one differing line) and
`toml_uninstall_restores_the_file_byte_for_byte` (whole-string equality after
install + uninstall). Both verified passing.

Three design calls worth recording:

- **The shared JSON/TOML generic did not survive, and should not have.**
  `strip_legacy_port_args<V>(&mut Vec<V>, …)` cannot work over
  `toml_edit::Array` — not a `Vec`, and its elements carry their own formatting,
  so the removal *mechanics* genuinely differ. What must not drift is the
  **rule**, and that is still exactly one function, `legacy_port_arg_indices`,
  which both format paths call.
- **An unchanged `command` is not rewritten at all**, because re-emitting it
  would normalise a literal `'…'` string the user typed into `"…"` — turning a
  no-op install into a diff.
- **`TomlEntryStyle` is not cosmetic**: inserting an `Item::Table` into an
  `InlineTable` is a **panic** in `toml_edit`, so a created entry must follow its
  parent's style. Pinned by a test.

**Where preservation stops, stated rather than papered over:** changing
`command` regenerates that value's quote style (spacing and trailing comment
survive); trivia attached to the deleted `--port`/`<n>` array elements is
deleted with them, though the array's *leading* trivia is explicitly rescued
onto the new first element; an inline-table append inherits the neighbour's
spacing.

Verified: `cargo test --lib` **1694 passed**, clippy clean, fmt clean, Windows
cross-target clean, `check-new-deps.sh` clean.

### Server-side script cap — DONE

The 64 KiB `MAX_SCRIPT_BYTES` was enforced in two places, **both above the Tauri
command boundary**: the MCP sidecar and the webview handler. Anything invoking
the command directly — a compromised webview, a bridge-dispatch bug, a future
caller that forgets — reached an unbounded `String`.

New `src-tauri/src/browser/script_limit.rs` (55 lines) holds the authoritative
gate. Its module doc records that the two client mirrors carry the same number,
that they are advisory, and that the three-way duplication is structural (no
shared constant surface spans the crate, the React app and the npm sidecar)
rather than accidental.

**A second uncapped command the audit did not name:** `browser_add_one_shot`
takes `eval_script: Option<String>` and hashes it to bind an "Allow once"
grant. Uncapped, a caller could mint authority bound to a script `browser_eval`
now refuses — dead authority the guard can never spend, which contradicts
`mint.rs`'s own stated principle that it must never store authority the guard
cannot enforce. Both are now gated.

Deliberately **not** capped, with reasons: the storage-state replay scripts are
built server-side from a page-derived blob addressed by a handle, so their size
is not caller-controlled and a cap would refuse legitimate large-session
restores while bounding nothing; the console shim is a compile-time constant.
There is no `browser_inject_css` command — `injectCss` is compiled into a script
client-side and arrives at `browser_eval`, so that cap covers it.

13 tests, 6 RED first. `str::len()` being UTF-8 bytes is *asserted*
(`"中".len() == 3`) rather than assumed — this is the one layer where the naive
length is correct, which is precisely why both JS mirrors needed explicit
encoding. The CJK case is built so char-count and byte-count disagree across the
cap, so a char-counting implementation fails it. Three source-level contract
tests via `include_str!` fail if either command drops the call **or if a new
script-ish argument appears in `commands_auth.rs` without one** — aimed
squarely at the "future caller forgets" mode, which is exactly what produced the
client-side gap.

Verified: `cargo test --lib` **1677 passed**, clippy clean, fmt clean, Windows
cross-target clean, file-size gate clean.

**Unreproduced anomaly, recorded not cleared:** one intermediate run reported
`1676 passed; 1 failed` with the test name lost to a `tail`. Three subsequent
full runs were clean at 1677/0, and cargo was under concurrent use by other
agents at the time. Most likely build-dir contention, but it was never
identified, so it is logged rather than dismissed.

### The `mcp_config` i18n "design decision" does not exist — the convention does

Round 2 deferred the i18n pass on the grounds that it *"needs a design decision,
not a mechanical one"*: whether to translate a wrapper like
`"Invalid JSON: {serde_error}"` when the substantive half stays English, which it
called cosmetic. That reasoning is defensible in the abstract, and the codebase
has already decided against it — consistently, and in plain view.

`src-tauri/src/pandoc/run.rs` translates exactly that shape, ten times over,
interpolating the untranslatable payload:

```yaml
pandoc.startFailed:    "Failed to start Pandoc: %{detail}"
pandoc.exitedWithCode: "Pandoc exited with code %{code}"
pandoc.taskPanicked:   "Pandoc task panicked: %{detail}"
```

```rust
t!("errors.pandoc.startFailed", detail = e.to_string())
```

So the rule to follow is **translate the wrapper, interpolate the payload via
`%{detail}`** — not a triage of actionable-vs-diagnostic. There are 1,218
`t!()` call sites across the crate and an `errors.mcp.*` namespace already
carrying two keys, so `mcp_config` is not un-i18n'd territory. It is an outlier
inside i18n'd territory: roughly **30 raw / 1 translated**, where a typical
module sits around 3 raw / 6 translated.

What remains is genuinely mechanical — ~30 keys under `errors.mcp.*` in
`en.yml`, then the same keys across the nine other locales, because
`checkYamlLocales` in `scripts/check-i18n-keys.ts` fails on any missing key and
(unlike the JSON path) has no "translation not started" escape hatch. Use the
`translate-docs` skill for the nine.

| Item | Why it was left | Where it belongs |
|---|---|---|
| ~~Splitting `browser`/`coherence` for honest annotations~~ — **REOPENED BY THE USER AND DONE (2026-07-28).** The close below stands on its facts and was wrong on the trade. No false safety claim existed, correct; but "the annotations over-declare danger — the safe direction" understated the cost. Over-declaring is safe for the *user* and expensive for the *agent*: it charges a human approval to the ARIA snapshot, the highest-frequency and lowest-risk call in the surface, which is exactly the tax that pushes an operator toward blanket-approving the tool that also carries `execute_js`. Split along one line — does the action modify anything? `browser_read` (read, screenshot, query, console, wait, wait_for) and `coherence` (status, edges, claims, contexts) now declare `readOnlyHint: true`; `browser` (8 mutating actions) and `coherence_resolve` keep the destructive annotation, and `coherence`'s header comment says READ-ONLY truthfully again. Surface 7 → 9, accepted against `20260504-mcp-pruning.md`'s ADR: that ADR's cost is *action* count and description bytes, both unchanged — the same 34 actions, re-partitioned. One capability moved rather than split: `console`'s `clear` evaluates `e.textContent = "[]"` in the page, a DOM write, so it is `console_clear` on the mutating tool. Nothing else changed — bridge request types are identical, and `coherence.resolve` authorization was always keyed on the authenticated bridge principal, so no security property moved. Two doc bugs fell out: `mcp-tools.md` still said resolution was "deliberately not exposed over MCP", and `mcp-setup.md` advertised a 12-tool count | — | Closed |
| ~~*(original close, retained for the record)*~~ — **the item was mis-stated.** Audited the shipped annotations from code (an earlier grep matched a *comment* reading "never `readOnlyHint: true`" and nearly produced a false bug report). Only `session` declares `readOnlyHint: true`, and its sole action is `get_state`, a pure read. Every tool with a mutating action declares `readOnlyHint: false, destructiveHint: true`. So the annotations **over-declare** danger — the safe direction — and no false safety claim exists. Splitting would take the surface 7 → 8+ tools against `20260504-mcp-pruning.md`'s ADR, whose reasoning (context cost, tool-selection accuracy degrading on crowded surfaces) still holds, to buy only client-side auto-approval of reads. Bad trade | — | Closed |
| ~~`roundtrip.property.test.ts` load-sensitive flake~~ — **DONE.** Root cause was the *implicit* timeout, not a slow test: the file executes in 289 ms but inherited vitest's 5 s wall-clock default, which CPU contention at full worker parallelism can exhaust. Each property test now carries an explicit `PROPERTY_TEST_TIMEOUT_MS = 30_000` with the incident and the reasoning recorded at the constant. Generous enough to remove the false signal, far short of hiding a genuine hang — a real regression here fails on an assertion in milliseconds, not by running long | — | Closed |
| ~~`lint:i18n` cannot see untranslated values~~ — **DONE**, see below | — | Closed |
| **superseded — see the two rows above** — 300 fast-check iterations on vitest's default 5 s timeout. Solo the file runs in 634 ms (≈8× headroom); it timed out during a `check:all` whose wall clock was 747 s vs a 232 s baseline, and passed 3/3 in isolation immediately after. Wants an explicit `testTimeout`. Plausibly the same class as the unreproduced `1676 passed; 1 failed` seen during the browser-cap work | Unrelated to the MCP surface; fixing it would not trace to this plan | Follow-up WI (CI reliability) |
| **`pnpm lint:i18n` cannot see untranslated values** — it checks key *presence*. Measured: **45–49 values per locale (~7%) of `src/locales/*/settings.json` are byte-identical to English**, including two `installMcp.*` keys adjacent to the ones added here. Gate has always been green. Wants a value-level check with an allow-list for legitimately identical strings (product names, symbols) | Found while adding React locale keys; a gate change is its own piece of work | Follow-up WI |
| ~~`toml_edit` for `~/.codex/config.toml`~~ — **DONE**, see below | — | Closed |
| ~~`read_existing_config` swallows parse errors, so a malformed config reads as "not installed"~~ — **DONE**, see below | — | Closed |
| ~~`websocket.ts` at 831 lines~~ — **DONE.** Split into 8 siblings along the responsibilities the code actually has (the audit named 4; reading it surfaced 4 more: in-flight request registry, socket lifecycle, reconnect loop, wire envelope). `websocket.ts` **831 → 299**, every sibling under 300, entry removed from the baseline. **No test file was modified** — the proof the refactor was behaviour-preserving. A "connection lifecycle" collaborator was rejected after reading: the regression suite binds white-box (`vi.spyOn(bridge, 'scheduleReconnect')`, `internal.sendImmediate = fn`), so extracting those would have required editing tests, which was forbidden precisely because it would mask a behaviour change. Every bug-history comment travelled with its code. Branch coverage dipped 0.01 in two scopes; investigated rather than lowered — the **uncovered** branch count is identical (115 → 115), the restructure removed a *covered* branch from the denominator, so the floors stand and every risen number was ratcheted up | — | Closed |
| ~~superseded~~eds a new `DiagnosticStatus` variant plus the React settings page | Follow-up WI |
| ~~8 dead exports in `vmark-mcp-server/src/server.ts`~~ — **DONE**, see below | — | Closed |
| `websocket.ts` at 831 lines | Audit §4 split, not these WIs. Now baselined so it cannot grow | Audit §4 |
| Splitting `browser`/`coherence` so read-only actions can be annotated honestly | Changes the tool surface shape, which this plan's non-goals rule out. The composite-tool annotation compromise is documented at each site | Needs a surface-shape decision |
| ~~Per-client credentials replacing the shared bridge token~~ — **DONE**, see below | — | Closed |
| ~~`README.md` rot in `vmark-mcp-server`~~ — **DONE**, rewritten against source | — | Closed |
| ~~i18n for `mcp_config` error strings~~ — **DONE**, see below | — | Closed |
| ~~`browser_eval` has **no** script size cap in Rust~~ — **DONE**, see below | — | Closed |
| ~~`selection.set` declares no `outputSchema`~~ — **DONE**, see below | — | Closed |

## Translation debt paid (2026-07-28)

The follow-up recorded as "~1,167 baselined untranslated locale values" is
closed: the baseline is **1,167 → 40**, and 2,253 English values across nine
locales now carry real translations. Three things surfaced that the original
item did not anticipate.

**The 1,167 was an undercount, not the debt.** `lint:i18n` only flags a value at
≥3 words AND ≥15 characters — the threshold that keeps `JSON`, `CLI` and
`Markdown` from being reported. Below it sat **1,869 more** English-identical
values (`Malformed YAML`, `Export failed`, `Resize panes`, …), invisible to the
gate and sitting in the same menus as the flagged ones. Paying only the
baselined set would have shipped half-translated menu groups, so all 403
distinct strings were done, not the 136 the gate could see.

**A flat/nested key collision was silently killing translations.** English
bundles store some keys as flat literals (`"terminal.maxSessions"`); several
locale bundles carry BOTH that flat key and a nested `terminal: { maxSessions }`.
i18next resolves the **nested** one (verified against the installed version, not
assumed), so a translation written to the flat key is dead and the user still
sees English. 731 such duplicated keys already existed at HEAD; writing to the
English file's path alone produced 14 dead translations before this was caught.

**Resolved, not just worked around.** All 747 duplicates are collapsed: every
locale bundle is rebuilt to mirror English's exact structure, keeping the value
that resolved before (nested-preferred, translation-preferred so a collapse can
never lose one). English itself had zero duplicates and used the flat path for
all 747, which made the canonical form unambiguous. Verified end to end — 2,253
values changed from English to a translation, **0 regressions and 0 lost keys**
against HEAD, measured on what i18next actually resolves rather than on file
contents.

**Then the mixed shape itself was removed.** Parity with English still left
English free to mix 1,535 flat keys with 496 nested ones, so the hazard was
contained rather than eliminated — a flat key added under a nested twin would be
shadowed again. All 4,960 nested keys across all ten locales are now flattened:
**20,310 flat keys, zero nested objects.** The asymmetry decided the direction —
with no objects in a bundle, i18next's nested branch *cannot* match, so flat
kills the bug class outright, whereas converging on nested would only have
re-armed it. Flat is also what `AGENTS.md` already documented and what 75% of
English already used.

Equivalence was proved against real i18next rather than by reasoning about file
contents: two instances loaded with the pre- and post-flattening bundles
resolved all **20,310 keys identically, 0 differences**.
`src/locales/__tests__/localeShape.test.ts` now fails on any nested object, any
key at two paths, and any path English does not use — and pins the two i18next
behaviours the rule rests on (a flat literal key resolves; nested wins when both
exist) so an upgrade that changes either surfaces here.

One residual noted in code rather than left implicit: the jsdom test mock
(`src/test/setup.ts`) resolves flat-before-nested, the opposite of real i18next.
That disagreement is what let a shadowed translation pass tests and ship as
English; it is harmless only while bundles stay flat, which the test now
guarantees.

**A bulk pass overwrites good translations if it is not conditioned on the
value.** The first run wrote every locale for every key it touched and clobbered
91 existing translations — French decimal commas (`1,6` → `1.6`), Japanese
full-width parentheses, a `ギュメ` → `ギユメ` typo, Korean `아니요` → `아니오`.
All 91 were restored; the rule is that a locale is only written when its current
value is byte-identical to English.

**The baseline is now EMPTY (1,167 → 0).** 40 values are legitimately identical
and can never be paid down: a literal path (`/Applications/Visual Studio
Code.app`), literal GitHub Actions runner labels (`ubuntu-latest / self-hosted /
linux / x64`), a bare interpolation (`{{index}} / {{count}}`), `1920px (Full
HD)`, and four cases where the target language's word IS the English one
(`Guillemets` in de/fr, `Double` in fr, `Test (test) -> Test (test)` in it).
Leaving them in a file whose contract is "translate these, count only goes down"
meant the baseline could never reach zero and a real regression had to be spotted
among permanent residents.

They now live in `scripts/i18nIdenticalAllowlist.ts`, each with a stated reason,
generalising the pattern `terminalI18nCoverage.test.ts` pioneered for the
`terminal.*` subtree. The list is checked in both directions — translating an
exempted string fails the gate until its dead exemption is deleted — and both
directions were mutation-tested (translate an exemption → stale error; revert a
translation → new-untranslated error). Pure logic is unit-tested in
`scripts/__tests__/i18nIdenticalAllowlist.test.ts`.

So the gate now says one thing per mechanism: **baseline = not translated yet,
must stay zero; allow-list = untranslatable, must stay justified.**

Also fixed: `src/locales/fr/export.json` carried three keys absent from English
and from every other locale (`pdf.headersFooters.date`, `pdf.preview.pageCount`,
`pdf.preview.pageCount_other`) with no code referencing them — dead keys from a
removed feature, dropped by the shape normalization.

## Definition of Done (plan)

- `pnpm check:all` green.
- `cargo test --lib` green; `cargo clippy --all-targets -- -D warnings` clean.
- Every WI above stamped DONE or BLOCKED with a reason.
