/**
 * Bridge operation manifest — the ONE declaration of every `vmark.*` wire
 * operation, its owner, and its effect (WI-1, audit-followups 20260729).
 *
 * The same surface exists in three independently maintained places:
 *   - server/mcp/src/bridge/operationSchemas.ts (the wire contract; its
 *     `BridgeRequest` union and the webview's field descriptors are
 *     GENERATED from it — WI-15)
 *   - src/services/mcpBridge/v2/dispatch.ts    (webview dispatcher cases)
 *   - src-tauri/src/mcp_bridge/state.rs     (`is_read_only_operation`) and
 *     src-tauri/src/mcp_bridge/routing.rs   (coherence arms + write guard)
 * They have drifted before (`vmark.browser.wait` classified read-only while
 * its handler mutated; fixed 2026-07-29). This manifest is the checked
 * mirror: `__tests__/operationManifestParity.test.ts` extracts all four
 * surfaces from source and fails on any operation missing here or classified
 * differently. Unknown operations stay fail-closed as writes on the Rust
 * side (`matches!` default) — the manifest adds proof, not routing.
 *
 * owner:
 *   - "webview": emitted to the focused window; lock policy decided by
 *     `is_read_only_operation` in state.rs.
 *   - "rust": answered entirely in Rust (`answer_coherence_async`), which
 *     takes the write lock itself for its `effect: "write"` members.
 *
 * @coordinates-with __tests__/operationManifestParity.test.ts — the enforcement
 * @module services/mcpBridge/v2/operationManifest
 */

export type OpOwner = "webview" | "rust";
export type OpEffect = "read" | "write";

export interface BridgeOperation {
  readonly owner: OpOwner;
  readonly effect: OpEffect;
}

export const BRIDGE_OPERATIONS = Object.freeze({
  // ── Session ──
  "vmark.session.get_state": { owner: "webview", effect: "read" },

  // ── Workspace (all mutate window/tab/file state) ──
  "vmark.workspace.new": { owner: "webview", effect: "write" },
  "vmark.workspace.open": { owner: "webview", effect: "write" },
  "vmark.workspace.open_workspace": { owner: "webview", effect: "write" },
  "vmark.workspace.save": { owner: "webview", effect: "write" },
  "vmark.workspace.save_as": { owner: "webview", effect: "write" },
  "vmark.workspace.close": { owner: "webview", effect: "write" },
  "vmark.workspace.switch_tab": { owner: "webview", effect: "write" },
  "vmark.workspace.focus_window": { owner: "webview", effect: "write" },

  // ── Document ──
  "vmark.document.read": { owner: "webview", effect: "read" },
  "vmark.document.write": { owner: "webview", effect: "write" },
  "vmark.document.transform": { owner: "webview", effect: "write" },

  // ── Workflow ──
  "vmark.workflow.validate": { owner: "webview", effect: "read" },
  "vmark.workflow.apply_patch": { owner: "webview", effect: "write" },

  // ── Selection ──
  "vmark.selection.get": { owner: "webview", effect: "read" },
  "vmark.selection.set": { owner: "webview", effect: "write" },

  // ── Browser ──
  // `wait` is write-class although it sounds like a read: its handler
  // activates the target window and creates/attaches the native browser
  // view (audit 20260729).
  "vmark.browser.read": { owner: "webview", effect: "read" },
  "vmark.browser.wait_for": { owner: "webview", effect: "read" },
  "vmark.browser.query": { owner: "webview", effect: "read" },
  "vmark.browser.screenshot": { owner: "webview", effect: "read" },
  "vmark.browser.act": { owner: "webview", effect: "write" },
  "vmark.browser.open": { owner: "webview", effect: "write" },
  "vmark.browser.navigate": { owner: "webview", effect: "write" },
  "vmark.browser.wait": { owner: "webview", effect: "write" },
  "vmark.browser.style": { owner: "webview", effect: "write" },
  "vmark.browser.execute_js": { owner: "webview", effect: "write" },
  "vmark.browser.session.save": { owner: "webview", effect: "write" },
  "vmark.browser.session.load": { owner: "webview", effect: "write" },
  "vmark.browser.console": { owner: "webview", effect: "write" },

  // ── Coherence (Rust-answered; lock policy in answer_coherence_async) ──
  // `edges` runs scan reconciliation (appends provenance) and `resolve`
  // appends a receipt — both serialize with document writes.
  "vmark.coherence.status": { owner: "rust", effect: "read" },
  "vmark.coherence.claims": { owner: "rust", effect: "read" },
  "vmark.coherence.contexts": { owner: "rust", effect: "read" },
  "vmark.coherence.edges": { owner: "rust", effect: "write" },
  "vmark.coherence.resolve": { owner: "rust", effect: "write" },
} as const satisfies Record<string, BridgeOperation>);
// Freeze the descriptors too — the outer freeze alone leaves each
// { owner, effect } mutable at runtime.
for (const op of Object.values(BRIDGE_OPERATIONS)) Object.freeze(op);

/**
 * Literal union of every operation name — `Readonly<Record<string, …>>`
 * would erase it and falsely type arbitrary string lookups as present.
 */
export type BridgeOperationName = keyof typeof BRIDGE_OPERATIONS;

/** Operation names filtered by manifest fields (test + tooling helper). */
export function operationsWhere(
  predicate: (op: BridgeOperation) => boolean
): string[] {
  return Object.entries(BRIDGE_OPERATIONS)
    .filter(([, op]) => predicate(op))
    .map(([name]) => name)
    .sort();
}
