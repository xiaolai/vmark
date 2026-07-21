# Plan: `open_workspace` MCP tool with approval gate

**Status:** DRAFT — Codex-reviewed (NEEDS AMENDMENT → amended below; disposition
table records every finding). The amended ADR-2 changes the approval model
fundamentally; re-read before Phase 1.

**Owner:** TBD · **Branch:** TBD (`feat/mcp-open-workspace`)

**Origin:** User request — "MCP tools don't have an open-workspace." Confirmed
gap: the `workspace` tool's `open` action opens a single **file**, not a
folder-as-workspace. User decision (this session): build it **behind a user
approval prompt**.

---

## Problem statement (verified — Codex F-01)

The `workspace` tool (`vmark-mcp-server/src/tools/workspace.ts:33`) exposes
`new | open | save | save_as | close | switch_tab | focus_window`. `open` emits
`vmark.workspace.open` with `filePath` (`:77`) and the frontend reads that file
into a tab (`hooks/mcpBridge/v2/workspace.ts:74`). Dispatch has no folder-open
action (`dispatch.ts:84`). **No action opens a directory as a workspace.**

The non-MCP path is reusable (Codex F-02, signatures confirmed):
`workspace.openFolder` (`services/commands/workspaceCommands.ts:53`) →
`openWorkspaceWithConfig(rootPath, opts): Promise<WorkspaceConfig|null>`
(`openWorkspaceWithConfig.ts:68`) + `restoreWorkspaceTabs(windowLabel, paths)`
(`restoreWorkspaceTabs.ts:30`) + `restoreSplitLayout(windowLabel, rootPath)`
(`:63`). **No Rust command is required to open** — but validation and routing
are NOT what the first draft assumed (see amended ADRs).

## The core problem: consent AND transport reality

Opening a folder **grants the agent a new file tree**, so it can't be authorized
by `checkBridgePath` (which only allows paths within already-allowed roots —
Codex F-11). It needs an explicit approval. **But** the Codex review found the
first draft's approval model was incompatible with the actual bridge transport.

## Verifiable success criteria (amended)

1. A new `open_workspace` action opens `folderPath` as the active workspace in
   the correctly-routed window — files sidebar, recents, restored tabs, split
   layout — identical to menu "Open Folder".
2. The action is **approval-gated** via the existing **fail-now → approve →
   AI-retry** one-shot model (NOT a blocking wait — see ADR-2). Denial clears the
   pending prompt and the retry fails closed.
3. After approval + open, follow-up **path-guarded** operations
   (`workspace.open`/`save_as`) targeting the new tree succeed — verified after
   the async Rust window→workspace registration barrier (Codex F-09).
4. Invalid input (missing path, not a directory, symlink to outside) is rejected
   with a canonicalized error; the prompt shows the **resolved canonical** path.
5. `EXPECTED_TOOL_COUNT` stays **7** (categories, not actions — Codex F-12); the
   `workspace` tool exposes **8 actions**; sidecar tests cover schema + approval
   flow.

---

## ADRs (amended per Codex review)

### ADR-2 — Approval = fail-now → approve → AI-retry one-shot (rewritten; Codex F-03/F-04)

The browser flow does **not** wait-and-resolve. It queues a prompt and
**immediately** responds `success:false / APPROVAL_REQUIRED`
(`browserNavigation.ts:34`); the sidecar tells the AI to ask, wait, retry
(`tools/browser.ts:30`); "once" mints a token (`browserApprovalStore.ts:207`)
consumed by the **retried** handler (`browserAct.ts:101`). Holding the original
MCP call is impossible: a write-class request holds the global write lock and
times out at 10s/20s (`mcp_bridge/server.rs:497,574,663` — Codex F-04).

**Therefore:** `open_workspace` returns `APPROVAL_REQUIRED` immediately, minting a
one-shot bound to (canonical folder path, resolved window, **authenticated
client** — Codex F-10). The UI resolves store state; the AI **re-issues** the
call, which consumes the token and opens. **Denial** clears the pending item and
produces no later response — the retry fails closed. No handler ever awaits a
human.

### ADR-3 — Canonical directory validation (rewritten; Codex F-06)

`read_workspace_config` does **not** verify existence/dir-ness and can return
`None` (`workspace.rs:317`); `openWorkspaceWithConfig` opens with defaults even
on invoke failure (`openWorkspaceWithConfig.ts:90`). A real canonicalize+is-dir
validator exists but is private to window management
(`window_manager/path_validation.rs:34`). **WI-1.1a exposes a reusable
validation IPC** (or promotes that validator). Validate **before** prompting and
**again** immediately before consuming the token; the prompt and the token bind
to the **canonical** path so a symlink can't conceal the granted tree.

### ADR-4 — Window routing via `windowId`, not `windowLabel` (new; Codex F-05)

Rust routing recognizes `windowId` (`routing.rs:117`) and path fields
`workspace_root`/`filePath`, **not** `folderPath` (`window_routing.rs:21`). The
first draft's `{folderPath, windowLabel?}` would route to the focused/`main`
window regardless. WI resolves the target window via the router's `windowId`
contract, validates it, and binds approval + open to that **resolved** window
(sidebar reveal is webview-local — `workspaceCommands.ts:61`). Resolves OQ-1.

### ADR-1 — Shared helper **owns the transition guard** (amended; Codex F-08)

Extract `openWorkspaceByPath(path, { windowLabel })` from `workspaceCommands.ts`,
and make it **own (or require) the per-window `WORKSPACE_TRANSITION_GUARD`** — the
existing guard wraps picker + post-dialog work (`:43`); extracting only the
post-dialog lines would let an MCP call race menu open/close. Reuse the helper
from the non-dirty `workspace.openRecent` path too (duplicate sequence at
`recentWorkspacesCommands.ts:113`).

---

## Phase 1 — Validation IPC + wire contract + shared helper + tool (approval-gated, RED→GREEN)

Merged with prior Phase 2 approval store (Codex F-13: approve/deny tests can't
precede the store). DoD: `scripts/check-mcp-openworkspace-phase.sh 1`.

| WI | Description | Traceability |
|---|---|---|
| WI-1.1a | Reusable canonical dir-validation IPC (promote `path_validation.rs`); returns canonical path or a typed error. Rust tests: missing, file-not-dir, symlink-resolves-outside, permission-denied, `..`/relative/NUL. | ADR-3, F-06 |
| WI-1.1b | `openWorkspaceByPath(path,{windowLabel})` helper owning the transition guard; refactor `workspace.openFolder` **and** `openRecent` to use it (behavior-preserving; existing tests green). | ADR-1, F-08 |
| WI-1.2 | Wire contract (Codex F-07): add the `open_workspace` variant to `BridgeRequest` (`core-types.ts:35`); a **workspace approval envelope/guard** (the only typed one is browser-specific — `:149`); a `toErrorResult`-equivalent so `sendBridgeRequest` failures become actionable (`server.ts:122,157`). Sidecar tests: schema, exact request, missing/invalid args, `APPROVAL_REQUIRED`, denial, ordinary error. | F-07 |
| WI-1.3 | Approval store + one-shot (Codex F-10): reuse/extend the browser approval store; bind the token to (canonical path, resolved `windowId`, **authenticated client identity** — extend the frontend event which today lacks a principal, `mcp_bridge/types.rs:58`); queue cap + dedup (`MAX_PENDING_APPROVALS`). Two-client race test. | ADR-2, F-10 |
| WI-1.4 | Tool: add `open_workspace` to the enum + `folderPath` schema + description (`tools/workspace.ts`); **do NOT bump `EXPECTED_TOOL_COUNT`** (categories — `index.ts:147`); update the workspace **action-count** text (`index.ts:109`); test 8 actions. | SC5, F-12 |
| WI-1.5 | Handler + dispatch (RED→GREEN): resolve+validate window (ADR-4) and path (ADR-3), return `APPROVAL_REQUIRED` first; on retry consume the token, re-validate, call the helper, respond success/denied/error. Dispatch case (`dispatch.ts`). Tests: approval-required, retry-approve, deny, invalid-path, non-dir, stale-window, path-substitution-after-approval, rapid repeat. | ADR-2, ADR-3, ADR-4, SC1, SC2, SC4 |
| WI-1.6 | Post-open routing barrier (Codex F-09): the frontend allowed-roots update is sync (`bridgePathGuard.ts:46`) but Rust's window→workspace map syncs fire-and-forget (`windowWorkspaceSync.ts:50`). Add an awaitable registration barrier (or an explicit-window follow-up contract) so a follow-up guarded op reaches the new workspace. Test with a real guarded op (`workspace.open`/`save_as`), incl. rapid multi-window follow-up. | SC3, F-09 |

## Phase 2 — Approval UI + docs + gate

| WI | Description | Traceability |
|---|---|---|
| WI-2.1 | Approval prompt in the **resolved** window (ADR-4): shows the **canonical** path + "grants access to this tree"; **no standing-grant** option (ADR-2). i18n all locales; selectors only. Tests incl. focused/settings/explicit/missing-window/retry-after-focus-change. | ADR-2, ADR-4, SC2, SC4 |
| WI-2.2 | Docs: `website/guide/mcp-tools.md` (new action + approval + **fix the stale `0.2.0`→`0.3.0` protocol note**, Codex F-15) and `mcp-setup.md` if approval UX needs a note. README entry already present. | rule 21, F-15 |
| WI-2.3 | Rebuild sidecar (`pnpm --dir vmark-mcp-server build:sidecar`); `--health-check` still reports **7 tools**. Create + wire `scripts/check-mcp-openworkspace-phase.sh` (it does not exist — Codex F-13); `pnpm check:all` green (`check-new-deps.sh` if any dep — none expected). | SC5, F-12, F-13 |

## Open questions (resolved / remaining)

- **OQ-1 (resolved):** target window via `windowId` (ADR-4), current window default.
- **OQ-2 (now an acceptance test — Codex F-14):** dirty tabs survive; `openFolder`
  leaves tabs open (`workspaceCommands.ts:57`) and restore skips already-open
  paths (`restoreWorkspaceTabs.ts:36`). Test, don't leave open.
- **OQ-3:** approval prompt must appear in the resolved document window even when
  the call originates while Settings is focused (WI-2.1).

## Cross-model review (rule 60 §6) — Codex disposition

Reviewer: `gpt-5.6-sol` (high effort, read-only, verified against the codebase).
Verdict: **NEEDS AMENDMENT** → amended above.

| Codex | Sev | Disposition |
|---|---|---|
| F-01 | CONFIRM | Kept — gap statement verified. |
| F-02 | CONFIRM | Kept — helper reuse sound; amended concurrency/error contracts (ADR-1). |
| F-03 | MAJOR | Accepted — ADR-2 rewritten to fail-now→approve→AI-retry one-shot. |
| F-04 | MAJOR | Accepted — ADR-2 forbids awaiting a human in-handler (write-lock/timeout). |
| F-05 | MAJOR | Accepted — ADR-4: route via `windowId`; `folderPath` not a routing field. |
| F-06 | MAJOR | Accepted — ADR-3 canonical dir-validation IPC (WI-1.1a), revalidate at consume. |
| F-07 | MAJOR | Accepted — WI-1.2 adds `BridgeRequest` variant + approval envelope + error translation + sidecar tests. |
| F-08 | MAJOR | Accepted — ADR-1: helper owns the transition guard; reuse in `openRecent`. |
| F-09 | MAJOR | Accepted — WI-1.6 routing-registration barrier + real guarded-op test. |
| F-10 | MAJOR | Accepted — WI-1.3 binds the one-shot to authenticated client identity; two-client race test. |
| F-11 | MINOR | Accepted — boundary wording fixed: `checkBridgePath` can't *authorize* boundary expansion (not "rejects every root"). |
| F-12 | MINOR | Accepted — SC5/WI-1.4/2.3 corrected: 7 tools, 8 workspace actions. |
| F-13 | MAJOR | Accepted — Phases reordered (store before handler); phase script WI-2.3; security/concurrency test WIs. |
| F-14 | CONFIRM | Accepted — dirty-tab safety becomes an acceptance test (OQ-2). |
| F-15 | MINOR | Accepted — drop the done README task; fix stale `0.2.0` protocol doc (WI-2.2). |

## Risks

- **R1 (high — Codex):** Approval-completion semantics — the transport supports
  fail→approve→retry, not wait-resolve. ADR-2 aligns to it.
- **R2 (high — Codex):** Window correctness — `windowLabel` doesn't route
  (ADR-4). Wrong-window state is a real hazard without it.
- **R3 (high — Codex):** Filesystem identity — canonicalize + bind + revalidate
  (ADR-3); a raw path display is insufficient for symlinks/substitution.
- **R4 (med — Codex):** Post-open routing race (WI-1.6).
