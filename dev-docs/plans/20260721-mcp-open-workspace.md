# Plan: `open_workspace` MCP tool with approval gate

**Status:** DRAFT — not started. Codex cross-model review (rule 60 §6) required
before Phase 1 because it introduces a new capability that **expands the AI
agent's filesystem reach**.

**Owner:** TBD · **Branch:** TBD (`feat/mcp-open-workspace`)

**Origin:** User request — "MCP tools don't have an open-workspace." Confirmed
gap: the `workspace` tool's `open` action opens a single **file**, not a
folder-as-workspace. User decision (this session): build it **behind a user
approval prompt**.

---

## Problem statement (verified)

The VMark MCP surface (`vmark-mcp-server/src/index.ts:87-93`) exposes a
`workspace` tool with actions `new | open | save | save_as | close |
switch_tab | focus_window` (`tools/workspace.ts:33-41`). `open` reads one file
into a tab (`hooks/mcpBridge/v2/workspace.ts:74-118`). **No action opens a
directory as the active workspace.**

The non-MCP path already exists and is reusable:
`services/commands/workspaceCommands.ts:37-77` (`workspace.openFolder`) opens a
folder dialog, then calls `openWorkspaceWithConfig(path)`
(`hooks/openWorkspaceWithConfig.ts:68-94` → `workspaceStore.openWorkspace`,
`workspaceStore.ts:121-127`), followed by sidebar reveal, recents add, tab
restore, split-layout restore. **No Rust command is required** —
`read_workspace_config` (`workspace.rs:317`) already exists; opening a workspace
is a frontend/store operation. Only the folder-*picker* is bypassed by MCP
(the agent supplies the path).

## The real design problem (not wiring): consent

`open`'s file path is confined by `checkBridgePath`
(`hooks/mcpBridge/v2/workspace.ts:90`) to `collectAllowedRoots()` — the current
workspace root ∪ parents of open documents (`services/mcpBridge/bridgePathGuard.ts:46-63`).
An **open-workspace target is, by definition, a NEW root OUTSIDE those allowed
roots**. Opening a workspace **grants the agent a whole new file tree**, so it
**cannot reuse `checkBridgePath`** — it is a boundary-*expanding* operation,
fundamentally unlike opening a file inside an already-consented tree. It
therefore needs its own consent model. User chose an approval prompt.

## Verifiable success criteria (plan level)

1. `vmark.workspace.open_workspace { folderPath }` opens that folder as the
   active workspace in the target window — sidebar files view, recents,
   restored tabs, restored split layout — identical to the menu "Open Folder".
2. The call is **gated by a user approval prompt** before any workspace opens;
   deny → no change, tool returns a denied result.
3. After approval, the newly opened root becomes an allowed root for subsequent
   file operations (so follow-up `document.read` etc. work).
4. Invalid input (non-existent path, a file not a directory) returns a clear
   error without a prompt.
5. The sidecar tool count contract and `website/guide/mcp-tools.md` are updated;
   `pnpm check:all` green.

---

## ADRs

### ADR-1 — Reuse the open path via an extracted shared helper (chosen)

Extract the post-dialog body of `workspace.openFolder`
(`workspaceCommands.ts:53-71`: `openWorkspaceWithConfig` + `showSidebarWithView`
+ `addWorkspace` + `restoreWorkspaceTabs` + `restoreSplitLayout`) into a shared
`openWorkspaceByPath(path, { windowLabel })` helper. Both the menu command and
the MCP handler call it. **Rejected — reimplement in the handler:** risks a
half-opened workspace (store set but tabs/rail/split not restored).

### ADR-2 — Consent model: per-call approval, no standing grant in v1 (chosen)

Model on the browser approval flow (`browserApprovalStore.ts` `requestApproval`
→ handler responds `{ needsApproval: true, ... }` non-blocking → UI prompt →
approve/deny; `browserNavigation.ts:34` `requestNavigationApproval` is the
reference). Because open-workspace is boundary-expanding and high-impact:

- v1 is **one-shot approval per call** — NO "remember this folder" standing
  grant (a remembered grant to open *any* folder would defeat the point).
- The prompt shows the exact `folderPath` and that it grants the agent access to
  that tree.
- **Rejected — unrestricted (no prompt):** the user explicitly chose approval,
  and silent fs-scope expansion by an untrusted client is unacceptable.
- **Rejected — allowlist file:** heavier; revisit only if users ask for
  unattended automation.

### ADR-3 — Path validation replaces `checkBridgePath`

The handler must NOT call `checkBridgePath` (it would reject every new root).
Instead: validate the path exists and is a directory (Rust `read_workspace_config`
already probes; add an explicit is-dir check if needed), reject otherwise
(SC4). On approval + open, the new root enters `collectAllowedRoots()` naturally
because it becomes the workspace root — verify this in a test (SC3).

---

## Phase 1 — Shared helper + tool + handler + dispatch (approval-gated)

DoD: `scripts/check-mcp-openworkspace-phase.sh 1` — asserts the tool action
exists in the enum, the handler + dispatch case exist, the shared helper is used
by both call sites, and the handler tests pass.

| WI | Description | Traceability |
|---|---|---|
| WI-1.1 | Extract `openWorkspaceByPath(path, { windowLabel })` shared helper from `workspaceCommands.ts`; refactor `workspace.openFolder` to call it (behavior-preserving; existing tests green). | ADR-1 |
| WI-1.2 | Add `open_workspace` to the `workspace` tool: enum (`tools/workspace.ts:33-41`), `folderPath` input property + schema, `case` emitting `{ type: 'vmark.workspace.open_workspace', folderPath, windowLabel? }`, description text (18-27). Bump the sidecar tool/action count contract. | SC1, SC5 |
| WI-1.3 | Frontend handler `handleWorkspaceOpenWorkspace(id, args)` in `hooks/mcpBridge/v2/workspace.ts`: validate dir (ADR-3), request approval (ADR-2), on approve call `openWorkspaceByPath`, respond success/denied/error. TDD: handler tests for approve, deny, invalid-path, non-dir. | SC1, SC2, SC4 |
| WI-1.4 | Dispatch case in `hooks/mcpBridge/v2/dispatch.ts` (near 84-104); `SUPPORTED_TOOL_PREFIXES` already covers `vmark.workspace.*`. Routing test. | SC1 |
| WI-1.5 | Test: after approval+open, `collectAllowedRoots()` includes the new root so a follow-up file op is allowed. | SC3 |

## Phase 2 — Approval UI

| WI | Description | Traceability |
|---|---|---|
| WI-2.1 | Approval prompt for the open-workspace operation: reuse the browser approval UI surface if it generalizes, else a focused prompt component. Shows `folderPath` + the "grants access to this tree" warning. No standing-grant option (ADR-2). i18n keys, all locales. | SC2, ADR-2 |
| WI-2.2 | Store/pending-approval wiring (reuse `browserApprovalStore` pattern or a dedicated store): queue cap + dedup like `MAX_PENDING_APPROVALS`, since the AI client is untrusted. Selectors only, no destructuring. Tests. | SC2 |

## Phase 3 — Sidecar, docs, gate

| WI | Description | Traceability |
|---|---|---|
| WI-3.1 | Rebuild the sidecar (`pnpm --dir vmark-mcp-server build:sidecar`); verify `--health-check` tool count matches the bumped contract. | SC5 |
| WI-3.2 | Docs: `website/guide/mcp-tools.md` (new action + approval behavior) and `website/guide/mcp-setup.md` if approval UX needs a note; `dev-docs/README.md` link. | rule 21, SC5 |
| WI-3.3 | `pnpm check:all` green (incl. `check-new-deps.sh` if any dep added — none expected). | SC5 |

## Open questions

- **OQ-1:** Should `open_workspace` open in the CURRENT window (like the menu) or
  support a new window? v1: current window (`windowLabel`), matching
  `workspace.openFolder`. Revisit if requested.
- **OQ-2:** Dirty tabs in the target window — the menu path preserves them
  (opening a workspace doesn't close tabs, `workspaceCommands.ts:57-60`). Confirm
  the MCP path inherits this (via the shared helper) — no data loss.
- **OQ-3:** Does the approval prompt need to appear in the *document* window even
  when the call originates while the Settings window is focused? Confirm target
  window routing in WI-2.1.

## Risks

- **R1 (med):** Security — a boundary-expanding tool. Mitigated by mandatory
  approval (ADR-2), no standing grant, explicit path in the prompt, and the
  Codex review gate.
- **R2 (low):** Sidecar tool-count contract drift breaking `check:all`. WI-3.1
  verifies the health-check count.
- **R3 (low):** Half-opened workspace if the helper isn't reused. ADR-1 + WI-1.1
  make the menu and MCP share one code path.
