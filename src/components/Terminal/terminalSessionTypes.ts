/**
 * terminalSessionTypes
 *
 * Purpose: Shared SessionEntry shape for the terminal-session orchestration
 * hooks (useTerminalSessions and its extracted lifecycle/registry helpers).
 * Kept in one place so the helpers don't re-declare the imperative
 * (non-React-state) session record.
 *
 * @module components/Terminal/terminalSessionTypes
 */
import type { RefObject } from "react";
import type { IPty } from "@/lib/pty";
import type { TerminalInstance } from "./createTerminalInstance";

/** Imperative per-session record (managed outside React's render cycle). */
export interface SessionEntry {
  instance: TerminalInstance;
  pty: IPty | null;
  ptyRefForKeys: RefObject<IPty | null>;
  spawnedCwd: string | undefined;
  shellStarted: boolean;
  shellExited: boolean;
  shellSpawning: boolean;
  disposed: boolean;
  /** Incremented on every (re)spawn; lets a stale PTY's onExit be ignored. */
  spawnGen: number;
  pendingRafId: number | null;
  /**
   * Workspace root that arrived while the shell was busy and so was deferred;
   * flushed on the next idle (see terminalSessionStoreSync).
   */
  pendingRoot?: string | null;
  /**
   * Last observed `instance.lastCommitTime`. When it changes, a new IME
   * commit has occurred and `lastCommittedConsumed` must reset to 0.
   */
  lastSeenCommitTime: number;
  /**
   * Number of chars from `instance.lastCommittedText` already deduped via
   * onData. Enables suffix-chunk matching for split CJK commits.
   */
  lastCommittedConsumed: number;
}

/** A ref to the live session map keyed by session id. */
export type SessionsRef = RefObject<Map<string, SessionEntry>>;
