export interface TabTransferPayload {
  tabId: string;
  title: string;
  filePath: string | null;
  content: string;
  savedContent: string;
  isDirty: boolean;
  workspaceRoot: string | null;
}

export interface TabDropPreviewEvent {
  sourceWindowLabel: string;
  targetWindowLabel: string | null;
}

/**
 * Two-phase handshake for taking a tab back out of the window it was moved to
 * (the Undo action on a tab move). Mirrors `tab_transfer.rs`.
 *
 *   prepare → destination reports the tab's CURRENT state, removes nothing
 *   commit  → destination removes the tab, once the source holds the restored copy
 *
 * The phases are separate so that a failure can only ever produce a duplicate
 * tab, never a destroyed one.
 */
type TabRemovalPhase = "prepare" | "commit";

/** Rust → destination window (event `tab:remove-by-id`). */
export interface TabRemovalRequestEvent {
  requestId: string;
  tabId: string;
  phase: TabRemovalPhase;
}

/** Destination window → Rust (event `tab:remove-ack`), returned to the source. */
export interface TabRemovalAck {
  requestId: string;
  tabId: string;
  phase: TabRemovalPhase;
  /** `false` = refused. The destination still holds the tab; do not restore. */
  accepted: boolean;
  reason?: string;
  /** The destination's live tab state. Present on an accepted `prepare`. */
  data?: TabTransferPayload;
}
