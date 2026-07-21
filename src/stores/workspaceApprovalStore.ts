/**
 * workspaceApprovalStore — one-shot approval for opening a folder as a workspace
 * via the open_workspace MCP tool.
 *
 * Opening a workspace GRANTS the AI a new file tree, so — unlike opening a file
 * inside an already-consented root — it can't reuse the path guard and must be
 * explicitly approved (plan ADR-2/ADR-3). The MCP transport can't hold a call
 * for human input (global write lock + 10/20s timeout, Codex F-04), so approval
 * is fail-now → approve → AI-retry: the handler requests approval and returns
 * needsApproval; the user's approval mints a ONE-SHOT bound to the CANONICAL
 * path, the target window, AND the authenticated client (Codex F-10); the AI
 * retries and the retry consumes it. No standing grants — a remembered grant to
 * open any folder would defeat the point (ADR-2).
 *
 * @coordinates-with hooks/mcpBridge/v2/workspace.ts — the open_workspace handler
 * @coordinates-with components (approval UI) — resolveApproval
 * @module stores/workspaceApprovalStore
 */
import { create } from "zustand";

/** Cap on queued prompts — the MCP client is untrusted; beyond this, drop. */
export const MAX_PENDING_WORKSPACE_APPROVALS = 32;

/** Approve mints a one-shot; deny just clears the prompt. */
export type WorkspaceApprovalOutcome = "approve" | "deny";

interface PendingWorkspaceApproval {
  id: string;
  /** Canonicalized target folder (symlinks resolved) — bound into the one-shot. */
  canonicalPath: string;
  windowLabel: string;
  clientId: string;
}

interface WorkspaceOneShot {
  canonicalPath: string;
  windowLabel: string;
  clientId: string;
}

interface WorkspaceApprovalState {
  pending: PendingWorkspaceApproval[];
  oneShots: WorkspaceOneShot[];
}

interface WorkspaceApprovalActions {
  /** Queue a prompt for the UI to resolve. Dedups by id and caps the queue. */
  requestApproval: (
    id: string,
    canonicalPath: string,
    windowLabel: string,
    clientId: string,
  ) => void;
  /** Resolve a prompt: `approve` mints a one-shot; `deny` just clears it. No-op
   *  on an unknown id. */
  resolveApproval: (id: string, outcome: WorkspaceApprovalOutcome) => void;
  /** Spend a one-shot matching (path, window, client) exactly. Returns whether
   *  it authorized — consuming is the point: one approval opens exactly once. */
  consumeOneShot: (
    canonicalPath: string,
    windowLabel: string,
    clientId: string,
  ) => boolean;
}

function sameKey(
  a: { canonicalPath: string; windowLabel: string; clientId: string },
  canonicalPath: string,
  windowLabel: string,
  clientId: string,
): boolean {
  return (
    a.canonicalPath === canonicalPath &&
    a.windowLabel === windowLabel &&
    a.clientId === clientId
  );
}

/** One-shot workspace-open approvals. Use selectors, not destructuring. */
export const useWorkspaceApprovalStore = create<
  WorkspaceApprovalState & WorkspaceApprovalActions
>((set, get) => ({
  pending: [],
  oneShots: [],

  requestApproval: (id, canonicalPath, windowLabel, clientId) => {
    set((state) => {
      if (
        state.pending.some((p) => p.id === id) ||
        state.pending.length >= MAX_PENDING_WORKSPACE_APPROVALS
      ) {
        return state;
      }
      return {
        pending: [...state.pending, { id, canonicalPath, windowLabel, clientId }],
      };
    });
  },

  resolveApproval: (id, outcome) => {
    const request = get().pending.find((p) => p.id === id);
    if (!request) return;
    set((state) => ({
      pending: state.pending.filter((p) => p.id !== id),
      oneShots:
        outcome === "approve"
          ? [
              ...state.oneShots,
              {
                canonicalPath: request.canonicalPath,
                windowLabel: request.windowLabel,
                clientId: request.clientId,
              },
            ]
          : state.oneShots,
    }));
  },

  consumeOneShot: (canonicalPath, windowLabel, clientId) => {
    const idx = get().oneShots.findIndex((o) =>
      sameKey(o, canonicalPath, windowLabel, clientId),
    );
    if (idx === -1) return false;
    set((state) => ({
      oneShots: state.oneShots.filter((_, i) => i !== idx),
    }));
    return true;
  },
}));
