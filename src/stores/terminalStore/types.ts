/**
 * terminalStore shared types — the session record, state and action shapes,
 * the combined store type, and the `set`/`get` aliases action creators take.
 *
 * Purpose: single type module for the terminal session store. Action and
 * selector modules import from here; this file imports nothing from them, so
 * the dependency flow stays one-directional (depcruise no-circular).
 *
 * Panel chrome — visibility, size, docked position — is NOT here: it is
 * window layout and lives in uiStore with the rest of the chrome.
 *
 * @module stores/terminalStore/types
 */

import type { StoreApi } from "zustand";

export interface TerminalSession {
  id: string;
  label: string;
  /**
   * Stable 1-based display number, allocated on create and reused when a
   * session closes. The tab's compact glyph comes from THIS, never from
   * parsing the label — the label is a display string that translation (or a
   * rename) is free to change, and parsing it made every tab show the same
   * character the moment it was not English.
   */
  ordinal: number;
  isAlive: boolean;
  /** A bell rang while this session was in the background. Cleared
   *  when the session becomes active. Drives the tab activity indicator. */
  hasActivity?: boolean;
  /** Program-reported title from xterm's onTitleChange (OSC 0/2) (G4).
   *  Shown on the tab unless the user manually renamed the session. */
  programTitle?: string;
  /** True once the user manually renamed the session — program titles then
   *  no longer override the user-chosen label (G4). */
  isUserRenamed?: boolean;
  /** A directory the session was explicitly asked to start in ("Open Terminal
   *  Here"). Consumed once by the spawn path, which must prefer it
   *  over the sibling-cwd inheritance that otherwise wins. Cleared on spawn so
   *  a later restart does not silently re-anchor the shell. */
  requestedCwd?: string;
  /** Interpreter family pinned to this Windows session; Python has a PowerShell host. */
  windowsShell?: "powershell" | "cmd" | "python";
  /** One-shot source, cleared after its PTY accepted the startup command. */
  pendingCode?: string;
  /** Claimed before the launcher write: restarts must never dispatch it twice. */
  codeBlockDispatched?: boolean;
  /** Owning workspace instance (WI-TS1.1, D-T1/D-T2). Stamped at creation from
   *  the active scope (via resolveTerminalOwnerInstanceId), or later by
   *  adoption/rekey. ABSENT ⇒ window-scoped: visible in every scope and
   *  followable by the workspace-cd sync. Never a placeholder id, and never
   *  cleared once set — owner changes are monotone (invariant 3). */
  workspaceInstanceId?: string;
}

export interface TerminalState {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  /** Per-scope "last shown session" memory (WI-TS1.2, D-T2): workspace
   *  instance id → session id, or null when the scope was showing nothing.
   *  Written by terminalSwitchScope for the OUTGOING scope; slots are dropped
   *  with their instance (close/move) and merged target-wins on rekey. */
  lastActiveByScope: Record<string, string | null>;
}

export interface TerminalActions {
  /** Create a session. `requestedCwd` pins its starting directory;
   *  without it the spawn path inherits a sibling's cwd or resolves the
   *  workspace/file default. `ownerInstanceId` stamps the session's owning
   *  workspace instance (WI-TS1.1) — callers resolve it via the ONE shared
   *  helper `resolveTerminalOwnerInstanceId(windowLabel)`; the store never
   *  imports workspace stores. Returns null when the creation-time union
   *  (D-T5: same scope ∪ window-scoped; all sessions when unscoped) is at
   *  MAX_TERMINAL_SESSIONS. */
  terminalCreateSession: (options?: {
    requestedCwd?: string;
    ownerInstanceId?: string;
    windowsShell?: "powershell" | "cmd" | "python";
    pendingCode?: string;
  }) => TerminalSession | null;
  /** Remove a session. When the removed session was active, the fallback
   *  active is picked from `opts.visibleIds` (the caller's visible population,
   *  D-T7/WI-TS1.2) when given, else from all remaining sessions (rail-off
   *  behavior, identical to before scoping). */
  terminalRemoveSession: (id: string, opts?: { visibleIds?: readonly string[] }) => void;
  terminalSetActiveSession: (id: string) => void;
  terminalMarkSessionDead: (id: string) => void;
  terminalMarkSessionAlive: (id: string) => void;
  terminalMarkActivity: (id: string) => void;
  terminalRenameSession: (id: string, label: string) => void;
  terminalSetProgramTitle: (id: string, title: string) => void;
  /** The explicit start directory for a session, without consuming it. */
  terminalPeekRequestedCwd: (id: string) => string | undefined;
  /** Clear it — only after the spawn that used it actually succeeded, so a
   *  failed spawn can still be retried in the directory the user asked for. */
  terminalClearRequestedCwd: (id: string) => void;
  terminalClearPendingCode: (id: string) => void;
  terminalClaimPendingCode: (id: string) => boolean;
}

/** Scope-transition actions (WI-TS1.2) — the kernel the rail coordinator and
 *  instance lifecycle call. Implementations in scopeActions.ts. */
export interface TerminalScopeActions {
  /** Stamp every window-scoped session with `instanceId` (absent →
   *  instanceId), renumbering ordinals on in-scope collision. Labels are
   *  untouched; never kills; idempotent. Callers guarantee `instanceId` is
   *  never a placeholder (D-T1). */
  terminalAdoptUnscopedSessions: (instanceId: string) => void;
  /** Record the outgoing scope's shown session into lastActiveByScope, then
   *  activate the incoming scope's remembered-live ?? first-visible ?? null,
   *  clearing hasActivity on the session it activates (D-T11). */
  terminalSwitchScope: (outgoingId: string | null, incomingId: string) => void;
  /** Same activation as terminalSwitchScope WITHOUT writing any outgoing
   *  memory — hydrate/close/move have no outgoing context. Idempotent. */
  terminalHydrateScope: (instanceId: string) => void;
  /** Remove every session stamped `instanceId` (the reconcile disposes their
   *  xterm + PTY) and drop the scope's lastActiveByScope slot. Callers realign
   *  via terminalHydrateScope(successor) when the closed scope was active. */
  terminalRemoveScopeSessions: (instanceId: string) => void;
  /** Re-stamp every oldId session to newId (loose-instance identity rekey,
   *  D-T6), renumbering ordinals on in-scope collision; lastActiveByScope
   *  merges target-wins. */
  terminalRekeyScope: (oldId: string, newId: string) => void;
  /** Realign the active session to the caller's VISIBLE population (R2-15):
   *  keep the current active if it is in `visibleIds`, else activate the
   *  first visible session, else null. Covers the rail-MODE toggle, where the
   *  visible population changes with no scope switch. Idempotent. */
  terminalRealignActive: (visibleIds: readonly string[]) => void;
}

export type TerminalStore = TerminalState & TerminalActions & TerminalScopeActions;

/** The store factory's `set`, passed into action creators. */
export type TerminalSet = StoreApi<TerminalStore>["setState"];
/** The store factory's `get`, passed into action creators. */
export type TerminalGet = StoreApi<TerminalStore>["getState"];
