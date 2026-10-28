/**
 * Purpose: Shared types for the pruned 4-tool MCP surface.
 *
 *   See .claude/adr/plans/20260504-mcp-pruning.md for the full ADR set.
 *   These types are exposed as part of the MCP server's public schema —
 *   changes to shape are breaking and must bump the action version.
 *   `BrowserSessionTab` is the browser-tab record `sessionSerializers.ts`
 *   builds for session.get_state (round 3 split of session.ts).
 *
 * @module services/mcpBridge/v2/types
 */

import type { AbortReason } from "@/services/agentJournal/journalClient";

/** Document kind discriminator. Drives which mutation tool applies. */
export type DocumentKind = "markdown" | "yaml-workflow";

/** Document tab info returned in session.get_state. */
export interface DocumentSessionTab {
  id: string;
  /**
   * Keep the pre-browser protocol discriminator. Clients use this value to
   * choose document.write versus workflow.apply_patch.
   */
  kind: DocumentKind;
  filePath: string | null;
  title: string;
  dirty: boolean;
  /** Per-document revision token (currently shares the global revision). */
  revision: string;
  /** Additive alias for clients that prefer an explicit field name. */
  documentKind: DocumentKind;
  /** True when this tab is the window's active tab. */
  active: boolean;
  /**
   * True when this tab actually renders in the window right now. Under the
   * workspace rail a window holds tabs from several workspace instances but
   * shows only the active one's, so a tab can exist, be activatable, and still
   * not be on screen (#1208). Without this the client cannot tell a successful
   * activation from one that landed in a hidden instance.
   */
  visible: boolean;
}

/** Browser tab info returned in session.get_state. */
export interface BrowserSessionTab {
  id: string;
  kind: "browser";
  /** True when this webpage is the currently visible page in its workspace. */
  active: boolean;
  /**
   * Page title — absent for a human tab the AI is not attached to (audit
   * 2026-09-03 X-02): attachment is the gate for AI access to a human tab, and
   * the title is page content.
   */
  title?: string;
  /**
   * Redacted URL (no userinfo, query or fragment). For an UNATTACHED human tab
   * this is the origin only — a path can carry a magic-login token — which is
   * enough to describe the tab when asking the user to attach it.
   */
  url: string;
  loading: boolean;
  generation: number;
  automationMode: "human" | "ai-sandbox" | "ai-shared";
  /** Human tabs only: whether the AI currently holds an attachment for the
   *  tab's present generation. AI-owned tabs need none and omit it. */
  attached?: boolean;
}

export type SessionTab = DocumentSessionTab | BrowserSessionTab;

export interface SessionWindow {
  label: string;
  /**
   * True when the OS focus is on this window. This is NOT "the window that
   * answered the request" — the bridge routes a request to whichever window
   * owns the relevant workspace, which need not be the one the user is looking
   * at (#1208).
   */
  focused: boolean;
  /**
   * The workspace instance this window is currently showing, or null when the
   * workspace rail is off (then every tab of the window is visible).
   */
  activeWorkspaceInstanceId: string | null;
  tabs: SessionTab[];
}

interface SessionCapabilities {
  /** App version — sourced from package.json. */
  version: string;
  /** Discriminator values supported by `document.transform` / mutation tools. */
  supportedKinds: DocumentKind[];
  /** MCP protocol version (distinct from app version). */
  mcpProtocol: string;
}

export interface SessionState {
  windows: SessionWindow[];
  capabilities: SessionCapabilities;
}

/** Standard error codes used across the four-tool surface. */
export type V2ErrorCode =
  | "STALE"
  | "INVALID_PATCH"
  | "INVALID_TAB"
  | "INVALID_PATH"
  | "READ_ONLY"
  | "NOT_WORKFLOW"
  | "NO_EDITOR"
  // Bridge write to a new location while autoApproveEdits is off — the user
  // must approve the edit. The agent should ask the user to enable approval
  // or confirm the destination, then retry.
  | "APPROVAL_REQUIRED"
  // Something transient is in the way: a window-transition already in
  // progress (open_workspace racing a menu "Open Folder"), or the user is
  // composing with an input method in the editor a write would change.
  // The agent should retry shortly.
  | "BUSY"
  // Too many pending approvals queued (untrusted-client flooding). The agent
  // should wait for the user to resolve them before retrying.
  | "RESOURCE_EXHAUSTED"
  // The agent edit journal refused the write before anything changed
  // (document.write). JOURNAL_BUSY: another write to the same document is in
  // flight — retry shortly. STALE_PARENT: another window changed the
  // document since this tab last wrote — re-read and retry. JOURNAL_DEGRADED:
  // an earlier record is still waiting to be written — retry later.
  // JOURNAL_UNAVAILABLE: the journal is not running. INVALID_TEXT: the
  // content holds a lone UTF-16 surrogate. REVIEW_BACKLOG_FULL: too many
  // unreviewed agent changes on the document.
  | "JOURNAL_BUSY"
  | "STALE_PARENT"
  | "JOURNAL_DEGRADED"
  | "JOURNAL_UNAVAILABLE"
  | "INVALID_TEXT"
  | "REVIEW_BACKLOG_FULL"
  // A write's `addresses` named a comment it may not: malformed, repeated,
  // unknown, deleted, resolved or of another document, or more than 64.
  | "INVALID_ADDRESSES"
  // The comment tools (vmark.comments.*). INVALID_COMMENT: a malformed or
  // unknown comment id, or a malformed request. STALE_COMMENT: the thread
  // changed or was deleted since its commentGen was read — list again.
  // COMMENT_NOT_ALLOWED: the thread is resolved. COMMENT_LIMIT: too many replies,
  // too long a body, a full comment store, or a thread that can change no more.
  | "INVALID_COMMENT"
  | "STALE_COMMENT"
  | "COMMENT_NOT_ALLOWED"
  | "COMMENT_LIMIT"
  // The journal accepted the write, but the document changed under it before
  // it applied (`reason` says how); nothing was written. Re-read and retry.
  | "ABORTED"
  | "INTERNAL";

interface V2ErrorBase {
  message: string;
  /** Optional payload — populated by STALE responses with the up-to-date revision. */
  current_revision?: string;
}

/** An error after which the document is as it was. */
interface NothingApplied {
  applied?: never;
  durable?: never;
}

/** INTERNAL after the edit changed the document (re-read it). */
interface EditApplied {
  applied: true;
  /** Whether the journal durably recorded the changed text. */
  durable: boolean;
}

/**
 * A V2 error envelope. Only ABORTED carries a `reason`, and it always does;
 * only INTERNAL may report an applied edit, and then always says whether it
 * is durable.
 */
export type V2Error =
  | (V2ErrorBase & NothingApplied & { error: "ABORTED"; reason: AbortReason })
  | (V2ErrorBase & NothingApplied & { error: Exclude<V2ErrorCode, "ABORTED">; reason?: never })
  | (V2ErrorBase & EditApplied & { error: "INTERNAL"; reason?: never });

/**
 * Construct a V2 error envelope.
 *
 * The bridge protocol carries `success: false` + `error: string`; we
 * encode the structured error as a JSON string in `error` so callers
 * can parse the code without changing the wire format.
 */
export function v2ErrorString(err: V2Error): string {
  return JSON.stringify(err);
}
