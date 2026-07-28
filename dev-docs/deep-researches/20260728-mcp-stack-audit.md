# VMark MCP Stack — Full Audit and Ecosystem Benchmark

> Date: 2026-07-28 · Method: four parallel investigations (TypeScript sidecar,
> Rust bridge, frontend handlers, online research) · Headline claims
> independently re-verified against source before archiving.

## Scope

Three code surfaces plus the ecosystem they live in:

| Surface | Path | Lines |
|---|---|---|
| MCP sidecar (stdio server) | `vmark-mcp-server/src/` | ~4.5k |
| Rust WebSocket bridge | `src-tauri/src/mcp_bridge/`, `mcp_server.rs`, `mcp_config/` | ~2.5k |
| Frontend handlers | `src/hooks/mcpBridge/` (+ `v2/`) | ~4k |

Baseline: no open MCP issues (a long history of `[audit]` issues, all closed);
the 7-tool / ~34-action surface is the deliberate post-pruning design of
`dev-docs/plans/20260504-mcp-pruning.md` (60 tools → 7). Findings below are
judged against that intent — none of them argue for re-expanding the surface.

## Verdict

The architecture is sound and, on the two controls that produced the entire
2025–2026 MCP CVE class, VMark is on the correct side: it binds loopback only
and requires a high-entropy token handshake — the exact fix Anthropic
retrofitted after CVE-2025-52882. Migration to the 2026-07-28 spec revision is
an SDK bump, not a rewrite, because the sidecar never touches `initialize`.

The serious problems are **not** on the transport. They are (a) an optimistic
concurrency guard that is blind to half the editor's input paths, (b) a config
writer that silently destroys other applications' settings, and (c) a
self-asserted string used as an authorization principal.

---

## 1. Bugs to kill

### 1.1 Source-mode edits never bump the revision — the STALE guard is blind

**Severity: critical (data loss).** `src/components/Editor/SourceEditor.tsx:153`,
`src/hooks/mcpBridge/revisionTracker.ts:24-38`,
`src/stores/documentStore/document.ts:201`.

ADR-4 of the pruning plan shipped `expected_revision` explicitly to stop AI
writes clobbering user keystrokes ("Skipping this ships a data-loss bug").
Revision bumps are wired into exactly one place — the Tiptap transaction
listener, via the sole `initializeRevisionTracking` call site at
`TiptapEditor.tsx:185`. CodeMirror source-mode typing calls
`setContentRef.current(newContent)`, and `documentStore.setContent` never
touches the revision store:

```ts
setContent: (tabId, content) =>
  set((state) => updateDoc(state, tabId, (doc) => ({
    content,
    isDirty: doc.savedContent !== content,
  }))),
```

So `document.write` / `document.transform` / `selection.set` carrying a
*correct* `expected_revision` captured before the user's source-mode keystrokes
passes `isCurrentRevision`, overwrites those keystrokes, and — because
`document.write` saves by default — persists the loss to disk. Verified:
non-test `updateRevision` callers are the tracker, `McpHistoryButton`, and the
MCP write handlers themselves. Nothing in the source-mode path.

### 1.2 `mcp_config` silently destroys other applications' configs on parse failure

**Severity: high.** `src-tauri/src/mcp_config/config_io.rs:82-83, 107`.

```rust
existing_content
    .and_then(|c| serde_json::from_str(c).ok())
    .unwrap_or_else(|| serde_json::json!({}));
```

A malformed `~/.claude.json` — which holds Claude Code's *entire* state, not
just MCP servers — or `~/.codex/config.toml` is parsed with `.ok()`, discarded,
and rewritten as a vmark-only config. Every other MCP server and setting is
destroyed. A timestamped backup is taken first on the install path, which makes
this recoverable rather than terminal, but it is silent. The uninstall path is
correct by contrast (`config_io.rs:136,147` returns `Err` on invalid input) —
so the fix is to match it: propagate the parse error instead of swallowing it.

Related, same module: the Codex TOML round-trip goes through `toml::Table`
rather than `toml_edit`, stripping all comments and reordering keys in a
hand-edited file on every install/uninstall (`config_io.rs:106-124`); a
non-table `mcp_servers` value causes install to silently succeed with vmark
absent (`config_io.rs:114-121`); backups accumulate forever with
second-granularity names that collide silently (`config_io.rs:161-168`).

**This entire module has zero tests** — every one of these would have been
caught by a table-driven test.

### 1.3 `workspace.open` on an already-open dirty tab discards unsaved edits

**Severity: high (data loss).** `src/hooks/mcpBridge/v2/workspace.ts:110-115`.

`tabStore.createTab` dedupes by normalized path and returns the *existing* tab
id; the handler then unconditionally calls `docStore.initDocument(tabId,
content, filePath)`, which replaces the document entry wholesale —
`savedContent = content`, `isDirty: false`, `documentId: 0`. No dirty check, no
checkpoint, no revision bump (so a stale AI revision token still "matches" the
reset content afterwards).

### 1.4 The read-only guard checks the active tab, not the targeted tab

**Severity: high.** `src/hooks/mcpBridge/handleRequest.ts:37`,
`src/services/editor/readOnlyGuard.ts:27-31`.

`READ_ONLY_BLOCKED` is enforced via `isActiveDocReadOnly()`, which resolves
`getActiveTabId(getCurrentWindowLabel())` — but `document.write`,
`document.transform` and `workflow.apply_patch` all accept a `tabId` targeting
background tabs. Two symmetric defects: a write to a read-only *background* tab
bypasses the guard entirely (buffer and disk both modified), and a write to a
writable background tab is wrongly rejected whenever the active doc happens to
be read-only.

### 1.5 `save_as` overwrites existing files with no existence check

**Severity: high (data loss).** `src/hooks/mcpBridge/v2/workspaceSaveAs.ts:79-100`.

With `autoApproveEdits: true`, `save_as` writes to any path inside the allowed
roots with no `exists()` check and no per-file confirmation. The blast radius is
set by `bridgePathGuard.collectAllowedRoots`
(`src/services/mcpBridge/bridgePathGuard.ts:46-63`), which adds the **parent
directory of every open document** — opening one file in `~/Documents` makes
everything under `~/Documents` writable. With approval on, the toast names only
the filename, never "will overwrite an existing file".

### 1.6 Timeout-retry can double-execute non-idempotent writes

**Severity: medium.** `src-tauri/src/mcp_bridge/server.rs:587-717`.

After the first 10 s timeout the bridge re-emits the *same* event with the same
request id. If the webview was merely slow rather than suspended, the original
handler still runs and the operation applies twice; the first execution's
response resolves the retry channel and the second is logged as
"unknown/expired", masking the duplication. Adjacent: a response landing in the
window between the original receiver being dropped and the retry channel being
installed returns `Err("Response channel closed")` to the frontend
(`mcp_bridge/commands.rs:24-36`).

### 1.7 Smaller confirmed bugs

| Finding | Location | Note |
|---|---|---|
| `disconnect()` leaks in-flight auth state | `websocket.ts:487-513` | Armed auth timer keeps the process alive up to 10 s, then settles `connect()` with the wrong reason |
| CJK `spacing`/`punctuation` transforms are structure-blind | `v2/documentTransform.ts:40-58` | Raw regex runs inside code fences and URLs — `文件.txt` → `文件。txt`. Only `cjk-format` uses the structure-aware `formatMarkdown` |
| `document.write` can report `saved: true` and leave the tab dirty | `v2/document.ts:157-201` | Disk gets raw `args.content`; Tiptap re-serializes and re-sets `isDirty` when the round-trip normalizes |
| `save_as` clears the pending-save marker synchronously | `workspaceSaveAs.ts:98-103` | `save` and `write` use the audited 1000 ms delayed clear; late FSEvents after `save_as` read as external modification |
| Dedup cache pins full payloads with no TTL | `requestDedup.ts:29-44` | 256 entries, count-evicted only — includes whole documents and base64 screenshots, for a ~20 s retry window |
| `document.write` checkpoint reads stale content | `v2/document.ts:294` | `selection.set` deliberately snapshots from the live editor because the store sync is RAF-debounced; `write` does not |
| Multi-window args write to phantom state | `v2/workspace.ts:46-67` | Each webview has an isolated store; `workspace.new {windowLabel}` creates a tab record the target window never renders |
| Dead ternary | `browserNavigation.ts:205` | `tabIdArg === undefined ? "TAB_NOT_FOUND" : "TAB_NOT_FOUND"` |
| Dead local-sidecar machinery | `mcp_server.rs:35,153,174,234` | `MCP_SERVER` is never assigned `Some`; `local_sidecar` is permanently false; both kill paths dead |
| Fabricated values in `windows.list` | `mcp_bridge/routing.rs:163-169` | Hardcodes `"filePath": null, "isAiExposed": true` |

---

## 2. Security

### 2.1 Self-asserted `identify.name` is used as an authorization principal

**Severity: high — the top security finding.** `mcp_bridge/state.rs:131-142`,
`server.rs:445-448`, `coherence_answers.rs:104-153`.

```rust
/// WI-3.5 (D2.3): the authenticated identity name of a connected client…
/// The only principal delegated authority binds to — never a caller-supplied
/// argument.
pub(crate) async fn authenticated_principal(client_id: u64) -> Option<String> {
```

The comment is wrong. `identity.name` comes from the client's `identify`
message, which any authenticated client may send — and re-send, as there is no
once-only guard. That string gates `coherence.resolve` via
`live_delegation_for(principal, …)` and is written into the ratification
receipt as `{"type":"agent","id": principal}`. The token proves possession of
**one shared bridge secret**; the name is whatever the client typed. Any
token-holder can impersonate another client and inherit its delegation grants.

Fix the comment regardless of whether the mechanism changes.

### 2.2 Where VMark stands against the CVE record

Every official MCP SDK shipped an HTTP/WS transport without Host/Origin
validation, and every one got a CVE — 22 across the org
(https://app.opencve.io/cve/?vendor=modelcontextprotocol), the most recent
CVE-2026-59950 (Python SDK, 2026-07-15). The directly comparable case is
**CVE-2025-52882** (Claude Code IDE extensions, CVSS 8.8): a localhost
WebSocket with no client authentication, on a dynamic port. Datadog's analysis
is explicit that the dynamic port was worth little — *"minimal security through
obscurity because port ranges could be systematically attacked with brute
force"* — and the shipped fix was **an auth token in a local file, presented by
the CLI on connect**. That is VMark's existing design.

| Control | VMark | Verdict |
|---|---|---|
| Bind address | `127.0.0.1:0` (`server.rs:58`) | Meets spec SHOULD |
| Mandatory auth | Token as first frame, 10 s deadline, identify-first rejected (`server.rs:227-309`) | Meets spec SHOULD; matches the CVE-2025-52882 fix |
| Token entropy | ~244 bits, OS CSPRNG (`state.rs:173-177`) | Above the ≥128-bit convention |
| `Origin` validation | **Absent** — plain `accept_async` | CWE-1385 |
| Constant-time compare | `if token == expected_token` (`server.rs:240`) | CWE-208 |
| Connection / message limits | None; tungstenite defaults (64 MiB) | DoS surface |
| Pre-auth allocation | `client_id` + 1024-slot channel + welcome issued before auth | Amplifies the above |
| Token file mode | 0600 by accident of `tempfile`; `preserve_target_permissions` carries any loosening forward; parent dir is `create_dir_all`, not 0700 | Should be explicit + verified |
| Sidecar verifies the server | **No** — accepts any `auth_result: success` | Stale-port spoofing |

Honest exploitability: the missing Origin check is **not** an RCE today. The
token gates every action and a browser page has no filesystem read primitive,
so it cannot learn the token. The reachable impact is unauthenticated DoS via
unbounded pre-auth allocation. Note also that Chrome 147 (2026-04-07) extended
Local Network Access permission prompts to WebSockets — many write-ups,
including Google's own LNA page, are out of date on this.

The timing oracle deserves more weight than it looks: it is reachable *only* by
the different-UID or browser attacker the token exists to stop (a same-UID
attacker just reads the file), so loopback TCP is the one design where it
matters.

### 2.3 Prompt-injection blast radius is the larger surface

Browser ops are approval-gated; `document.write` and `workspace.save` are not.
`document.write` persists to disk by default with only a path guard, and the
guard's roots include the parent directory of every open document. An agent
that reads untrusted web content and can write anywhere under `~/Documents` in
the same session is exactly the combination the guidance says to decompose.
For calibration: Anthropic's browser agent was hijacked 23.6% of the time
without safeguards, 11.2% with them.

### 2.4 Accepted limitations (documented, not defects)

Same-UID processes can read the port file and hold full authority — no local
IPC mechanism fixes this ("there is no way for Chrome, or any application, to
defend against an attacker who can run software with the privileges of your
operating system user account"). The path guard has a documented TOCTOU window
(`mcp_bridge_path_guard.rs:16-20`). Both are correct calls for a local
single-user editor; they belong in user-facing docs.

---

## 3. Gaps to fill

### 3.1 The sidecar coverage gate is configured, red, and never run

`vmark-mcp-server/vitest.config.ts:18-23` sets thresholds of 90/70/90/90.
Actual: **statements 72.0%, branches 68.0%, functions 73.3%, lines 71.6%** —
`pnpm test:coverage` in that package exits non-zero today. It never runs:
root `check:all` invokes `test:sidecar`, which is `pnpm --dir vmark-mcp-server
test` = `vitest run`, no coverage. Verified in `package.json:51,53`.

Per-file: `src/cli.ts` **0%**, `tools/document.ts` **5.3%**,
`tools/selection.ts` **7.7%**, `tools/workflow.ts` **7.7%**,
`tools/workspace.ts` **40.9%**. `cli.ts` is the *entire* SDK boundary —
`registerTool`, the capabilities object, the `McpServer`/`StdioServerTransport`
wiring — and the test client deliberately "simulates MCP protocol without
needing a real MCP SDK client" (`__tests__/utils/McpTestClient.ts:2-3`), so
nothing ever exercises the real one.

AGENTS.md's claim that "coverage thresholds are enforced" does not hold for
this package.

### 3.2 Other test gaps

- **Rust:** the entire auth handshake (only token *generation* is tested), the
  timeout/retry path including the double-execution hazard above,
  `force_disconnect_client`, re-identify behavior, all of `mcp_server.rs`, and
  all of `mcp_config/`.
- **Frontend:** the dispatch "surface lock" test
  (`v2/__tests__/dispatch.test.ts:224-253`) compares the test's *own* 20-entry
  table against a hardcoded literal — it never inspects `dispatch.ts`, which
  routes 29 types, leaving 9 routes untested. No test covers the tabId-targeted
  read-only bypass, the dirty-tab reset, or source-mode revision behavior.
  `wrapHandler.test.ts` has 2 tests and no double-respond case. Stale
  `registerEdit` mocks in two tab-action test files mock a revision-store method
  that does not exist.

### 3.3 MCP protocol features not used

Zero of the 7 tools declare `annotations`, `title`, or `outputSchema`. Every
success is `JSON.stringify(data, null, 2)` in a text block
(`server.ts:182-187`) — including `document.write`'s carefully designed
machine-readable `saved` / `save_skipped` / `current_revision` fields, which
are precisely the case `structuredContent` exists for. No pagination or output
truncation anywhere (`document.read` returns whole documents; the ecosystem
convention is a 25,000-token cap with a steering message). No `response_format`
enum. No progress notifications for the 12–25 s operations, and a client
`notifications/cancelled` does not abort an in-flight bridge request.

Caveat that prevents over-investing: per canimcp.dev, tool annotations are
honoured by **VS Code only** today, and elicitation is partial in Claude Code
and absent in Codex CLI — so annotations are cheap correctness and
future-proofing, not a behavior change, and **elicitation cannot replace the
custom `coherence` approval path** for VMark's actual target clients.

### 3.4 Schema fidelity is silently lossy

`src/utils/jsonSchemaToZod.ts` models only `type/description/enum/default/
oneOf/items/properties/required`. Everything else is dropped without error,
and structural typing on `properties: Record<string, unknown>` means declaring
more produces no compile error. Live loss: `tools/browser.ts:183-188` declares
`timeoutMs: {minimum: 1, maximum: 12000}` and the client-visible schema has
neither bound. Also dropped: `anyOf`, `allOf`, `const`, `pattern`, `format`,
`minLength`, `additionalProperties`, `$ref`. Non-string enum members would be
mis-cast. The root cause is an inverted pipeline — hand-written JSON Schema →
Zod → the SDK converts *back* to JSON Schema.

### 3.5 Capability gaps an AI client will feel

Deliberately pruned, but worth revisiting on evidence: no workspace file
listing or content search (`content_search.rs` exists; the AI must know exact
paths for `workspace.open`), no ranged/partial `document.read` (full-doc token
cost on large files), no markdown lint or link-check exposure (only workflow
YAML gets `validate`), no checkpoint list/restore action (MCP-edit undo is
UI-only), no dirty-diff read. Also: `workflow.apply_patch` is buffer-only and
neither the handler nor the schema says so, so an AI reasonably believes disk
was updated (`v2/workflow.ts:244-264`).

### 3.6 Schema/handler mismatches

`workspace.new` advertises `kind: markdown|yaml-workflow`; the handler never
reads `args.kind` (`v2/workspace.ts:56-68`). `open_workspace` advertises
`windowLabel`; the handler deliberately ignores it (documented, deferred). Two
incompatible error contracts coexist: browser handlers emit bare strings
(`failure(id, "BROWSER_DISABLED")`) while the rest emit the structured
`V2Error` JSON envelope, and `V2ErrorCode` has no browser codes. `INTERNAL` is
used for caller mistakes, mislabelling validation errors as server faults.
`core-types.ts:140-142` claims tools parse the error envelope opportunistically
— nothing does, and `BridgeResponse.code` is never read.

---

## 4. Refactoring

| Item | Location | Why |
|---|---|---|
| **Delete the legacy mock** | `__tests__/mocks/mockBridge.ts` (930 lines) + its test (468) | Imports 12 types that **do not exist**; simulates only pre-prune request types no current code can send. Compiles nowhere: `tsconfig.json:25` excludes `__tests__`, lint covers only `src`, vitest transpiles without type-checking. ~1,300 lines, zero live callers |
| **Type-check and lint `__tests__/`** | `vmark-mcp-server/tsconfig.json`, `package.json:17` | The condition that let the above rot |
| **Extend the file-size gate to the sidecar** | `scripts/check-file-size.mjs:19` | `ROOTS = ["src", "src-tauri/src"]` — the package is invisible to the gate. Violators: `websocket.ts` 831, `browser.ts` 460, `cli.ts` 322, `server.ts` 303 |
| **Split `mcp_bridge/server.rs`** | 746 lines (baselined 752) | `handle_message` alone is ~310 lines with a triple-nested timeout/retry arm; the "remove pending + error + return" block is copy-pasted 5× and the retry re-emit duplicates `emit_to_window_or_reply` inline (~80 lines removable) |
| **Collapse the JSON-Schema→Zod layer** | `utils/jsonSchemaToZod.ts` (156 lines) | Author schemas in Zod once; deletes the converter and its lossiness together (§3.4) |
| **Delete dead exports** | `server.ts:213-303` | `resolveWindowId`, `validateNonNegativeInteger`, `getStringArg`, `requireStringArg`, `getNumberArg`, `requireNumberArg`, `getBooleanArg`, `getWindowIdArg` — no tool uses any of them; the resource pipeline is exercised only by tests and a dead cli loop |
| **Deduplicate v2 boilerplate** | `src/hooks/mcpBridge/v2/` | `structuredError` redefined in 7 files; the browser gate preamble 4×; human-attachment consumption 4×; `resolveKind` verbatim in 3; tab-owner lookup in 7 |
| **Share cross-repo constants** | `core-types.ts:24` ↔ `v2/session.ts:53`; `browser.ts:21` ↔ `browserPower.ts:38` | `MCP_PROTOCOL_VERSION` and `MAX_SCRIPT_BYTES` are hand-duplicated; the whole `BridgeRequest` union mirrors the app's dispatch with no shared source or contract test |
| **Move `cjkMaps.ts`** | `v2/cjkMaps.ts` | Leaf-pure data table; ADR-013 puts it in `utils/` or `lib/cjkFormatter` |
| **Untrack build artifacts** | `__tests__/utils/McpTestClient.js`, `.js.map` | Git-tracked compiled copies of the sibling `.ts` |
| **Harden the build script** | `scripts/build-sidecar.js:69-123` | Commands built by string-join through `exec` with unquoted interpolated paths — breaks on any path with a space; `--external:fsevents` is cargo-cult while ws's real optional natives (`bufferutil`, `utf-8-validate`) are not marked external |

### Documentation rot (part of the tested surface)

`src/index.ts:101-144` `TOOL_CATEGORIES`: workspace says "7 actions" (8),
browser "5 actions" (13), coherence "2 read-only actions" (5, one of them
mutating). The `README.md` is materially wrong throughout — default port 9224
and `host: 'localhost'` (actual: resolver-discovered, `127.0.0.1`), a
`windowId` multi-window section describing a deleted surface, queue-overflow
behavior that doesn't match the code, and "resolving an edge is deliberately
not exposed over MCP" contradicted by the shipped `resolve` action.
`cli.ts:20-21` claims `VERSION` is "injected at build time"; nothing injects
it — the bump procedure's `sed` maintains it. Frontend comment rot: "pruned
5-tool surface" (`useMcpBridge.ts:5`) and "pruned 4-tool surface"
(`v2/types.ts:2`) for what is now 7; `v2/types.ts:26` says revisions are global
when they have been per-tab since WI-0.10.

---

## 5. Ecosystem position (July 2026)

**Spec.** Current at check time was 2025-11-25; the 2026-07-28 revision was
scheduled to publish the day of this audit (RC locked 2025-05-21; SDK v2
already stable against it). That revision removes `initialize`/`initialized`
and `Mcp-Session-Id`, moving metadata into `_meta` on every request, and adds
`server/discover`. **VMark is unaffected structurally** — verified zero
occurrences of `protocolVersion` or any spec-date literal in the sidecar
source; it delegates entirely to the SDK. Roots, Sampling, Logging, and Dynamic
Client Registration are now deprecated (≥12-month removal policy); VMark uses
none of them, and its stderr logging is the newly recommended path.

**stdio is safe long-term.** "MCP will continue to support only two official
transports: STDIO for local deployments and Streamable HTTP for remote." Do not
migrate for spec-currency reasons.

**SDK.** `@modelcontextprotocol/sdk` 1.29.0 installed, 1.30.0 current (no
breaking changes; adds stdio buffer limits). v1 gets fixes for ≥6 months after
v2 stable (≈ Jan 2027); the v2 packages require **node ≥20** and there is a
codemod. zod v4 is officially supported. `registerTool` is the correct API and
VMark uses it. All dependencies are current and legitimate.

**Do not embed an HTTP server in the app.** Every official SDK that did shipped
a CVE for it. It buys multi-client support a single-user editor doesn't need
and costs browser-reachable surface plus VS Code's stdio sandboxing. If the
transport is ever revisited, the move with precedent is UDS / named pipe —
`P3GLEG/tauri-plugin-mcp` (the closest architectural twin) defaults to UDS with
a 0600 token file and constant-time compare, Claude Code's own browser bridge
uses UDS, and VS Code can connect to `unix://` and `pipe://` paths directly.
Three footguns if attempted: never Linux abstract sockets, never Windows
AF_UNIX (use named pipes with a logon-SID DACL), and the portable control is a
0700 parent directory, not the socket mode. Budget real Windows time —
Anthropic and `tauri-plugin-mcp` both shipped that leg broken.

**Conformance.** An official suite now exists
(https://github.com/modelcontextprotocol/conformance) but its server mode is
**HTTP-only** — `--command` exists only for client testing, so a stdio server
cannot be tested directly without a shim. Adoptable today instead: the MCP
Inspector CLI (`npx @modelcontextprotocol/inspector --cli <binary> --method
tools/list`), which would cover the entire untested SDK boundary in one smoke
test, and the mcp-builder evaluation format (10 read-only, multi-tool,
verifiable Q&A pairs).

## 6. Refuted / corrected claims

- **"The bridge is unauthenticated."** False. `portFile.ts:100-139` parses
  `{port}:{token}`; `state.rs:173-177` generates ~244 bits from the OS CSPRNG;
  `server.rs:227-309` requires it as the first frame.
- **"The dynamic port is a security advantage."** False. Datadog on
  CVE-2025-52882: dynamic localhost ports are "minimal security through
  obscurity because port ranges could be systematically attacked with brute
  force." The token does all the work; the port is anti-collision.
- **"The spec mandates `Host` validation."** It does not — that is SDK
  behavior. The spec mandates `Origin` validation with a 403 response.
- **"LSP mandates stdio for security."** Extrapolation — the LSP spec contains
  no occurrence of `authentication`, `security`, `trust`, or `TLS`.
- **CVE-2018-5702 is Transmission**, not uTorrent (common misattribution).

## 7. Caveats

- The 2026-07-28 spec publication was scheduled for the audit date;
  `/specification/2026-07-28` returned 404 at check time and content was served
  from `/specification/draft/`. Treat as landing, not confirmed-live.
- The CVE inventory in §2.2 was compiled with URLs by a research agent;
  CVE-2025-52882 and CVE-2025-49596 were independently verified, the remainder
  were not re-verified.
- `browserWaitFor` one-shot attachment consumption (poll #2+ on a human tab)
  and `browser.open` ghost-tab accumulation across approval retries are
  suspected from reading, not reproduced.
- No authoritative ruling exists on action-dispatch ("god") tools; the
  defensible objection is mechanical — one `action` enum cannot carry per-action
  `annotations` or `outputSchema`, and `browser` needs to be both
  `readOnlyHint` and `destructiveHint`.
- Web-search budget was exhausted (200/200) during the research pass.

## 8. Suggested order of work

1. Revision tracking for source mode (§1.1) — the guard is load-bearing and
   currently half-connected.
2. `mcp_config` parse-failure propagation + first tests (§1.2).
3. `workspace.open` dirty-tab guard, read-only guard by tabId, `save_as`
   overwrite check (§1.3–1.5).
4. Fix the `authenticated_principal` comment; decide whether per-client
   credentials are warranted (§2.1).
5. Make the sidecar coverage gate real, or delete it — and add one Inspector
   CLI smoke test for `cli.ts` (§3.1).
6. Delete `mockBridge` and type-check `__tests__/` (§4).
7. Bridge hardening: Origin allowlist (absent header = non-browser = allow),
   constant-time compare, message-size and connection caps, no pre-auth
   allocation, explicit-and-verified 0600 token file (§2.2).
8. Tool-quality pass: annotations, `structuredContent`, output truncation,
   Zod-first schemas (§3.3–3.4).
