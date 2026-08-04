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
 * @coordinates-with services/mcpBridge/v2/workspace.ts — the open_workspace handler
 * @coordinates-with components (approval UI) — resolveApproval
 * @module stores/workspaceApprovalStore
 */
import { create } from "zustand";

/** Cap on queued prompts — the MCP client is untrusted; beyond this, drop. */
export const MAX_PENDING_WORKSPACE_APPROVALS = 32;

/** Cap on minted-but-unconsumed one-shots. A human must click to mint each, so
 *  this only bounds pathological accumulation from approve-without-retry. */
export const MAX_WORKSPACE_ONE_SHOTS = 8;

/** A one-shot represents a FRESH approval: if the AI does not retry within this
 *  window it is stale and must be re-approved (a grant must not stay spendable
 *  long after the human's "fresh" consent). */
export const WORKSPACE_ONE_SHOT_TTL_MS = 5 * 60_000;

/** Approve mints a one-shot; deny just clears the prompt. */
export type WorkspaceApprovalOutcome = "approve" | "deny";

/** Outcome of requestApproval: a NEW prompt was queued, an EQUIVALENT one is
 *  already pending (deduped), or the queue is full (untrusted-client flooding). */
export type RequestApprovalResult = "queued" | "existing" | "overloaded";

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
  /** Date.now() at mint — drives TTL expiry (WORKSPACE_ONE_SHOT_TTL_MS). */
  createdAt: number;
}

interface WorkspaceApprovalState {
  pending: PendingWorkspaceApproval[];
  oneShots: WorkspaceOneShot[];
}

interface WorkspaceApprovalActions {
  /** Queue a prompt for the UI to resolve. Dedups by id AND by the semantic
   *  key (path+window+client) so rapid retries with fresh ids cannot stack
   *  identical dialogs; caps the queue. Returns what happened. */
  requestApproval: (
    id: string,
    canonicalPath: string,
    windowLabel: string,
    clientId: string,
  ) => RequestApprovalResult;
  /** Resolve a prompt: `approve` mints a one-shot; `deny` just clears it. No-op
   *  on an unknown id. */
  resolveApproval: (id: string, outcome: WorkspaceApprovalOutcome) => void;
  /** True if a live (non-expired) one-shot matches (path, window, client) —
   *  a non-consuming peek so the handler can acquire the transition guard
   *  BEFORE spending the grant. */
  hasOneShot: (
    canonicalPath: string,
    windowLabel: string,
    clientId: string,
  ) => boolean;
  /** Spend a live one-shot matching (path, window, client) exactly. Returns
   *  whether it authorized — consuming is the point: one approval opens exactly
   *  once. Expired grants are pruned, never spent. */
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

/** Drop one-shots older than the TTL. */
function pruneExpired(oneShots: WorkspaceOneShot[], now: number): WorkspaceOneShot[] {
  return oneShots.filter((o) => now - o.createdAt < WORKSPACE_ONE_SHOT_TTL_MS);
}

/** A partial-state patch that physically removes expired one-shots — empty when
 *  none expired, so no needless re-render. Every action applies this so garbage
 *  cannot linger between the consume/approve paths that already prune. */
function expiryPatch(oneShots: WorkspaceOneShot[], now: number): { oneShots?: WorkspaceOneShot[] } {
  const pruned = pruneExpired(oneShots, now);
  return pruned.length === oneShots.length ? {} : { oneShots: pruned };
}

/** One-shot workspace-open approvals. Use selectors, not destructuring. */
export const useWorkspaceApprovalStore = create<
  WorkspaceApprovalState & WorkspaceApprovalActions
>((set, get) => ({
  pending: [],
  oneShots: [],

  requestApproval: (id, canonicalPath, windowLabel, clientId) => {
    let result: RequestApprovalResult = "queued";
    set((state) => {
      const patch = expiryPatch(state.oneShots, Date.now());
      // Dedup by transport id OR by semantic key: a client retrying with a
      // fresh id must not stack a second identical dialog (each of which could
      // mint its own grant on approval).
      const duplicate = state.pending.some(
        (p) => p.id === id || sameKey(p, canonicalPath, windowLabel, clientId),
      );
      if (duplicate) {
        result = "existing";
        return patch;
      }
      if (state.pending.length >= MAX_PENDING_WORKSPACE_APPROVALS) {
        result = "overloaded";
        return patch;
      }
      return {
        ...patch,
        pending: [...state.pending, { id, canonicalPath, windowLabel, clientId }],
      };
    });
    return result;
  },

  resolveApproval: (id, outcome) => {
    const request = get().pending.find((p) => p.id === id);
    if (!request) return;
    set((state) => {
      const now = Date.now();
      const pending = state.pending.filter((p) => p.id !== id);
      if (outcome !== "approve") return { pending, ...expiryPatch(state.oneShots, now) };
      // Prune expired, drop any prior grant with this exact key (no stacking),
      // append the fresh one, and cap to the newest MAX_WORKSPACE_ONE_SHOTS.
      let oneShots = pruneExpired(state.oneShots, now).filter(
        (o) => !sameKey(o, request.canonicalPath, request.windowLabel, request.clientId),
      );
      oneShots = [
        ...oneShots,
        {
          canonicalPath: request.canonicalPath,
          windowLabel: request.windowLabel,
          clientId: request.clientId,
          createdAt: now,
        },
      ];
      if (oneShots.length > MAX_WORKSPACE_ONE_SHOTS) {
        oneShots = oneShots.slice(oneShots.length - MAX_WORKSPACE_ONE_SHOTS);
      }
      return { pending, oneShots };
    });
  },

  hasOneShot: (canonicalPath, windowLabel, clientId) => {
    const now = Date.now();
    const live = pruneExpired(get().oneShots, now);
    // Physically drop expired grants so they cannot linger between prunes.
    if (live.length !== get().oneShots.length) set({ oneShots: live });
    return live.some((o) => sameKey(o, canonicalPath, windowLabel, clientId));
  },

  consumeOneShot: (canonicalPath, windowLabel, clientId) => {
    const live = pruneExpired(get().oneShots, Date.now());
    const idx = live.findIndex((o) => sameKey(o, canonicalPath, windowLabel, clientId));
    if (idx === -1) {
      // Write back the pruned list so expired grants do not linger.
      if (live.length !== get().oneShots.length) set({ oneShots: live });
      return false;
    }
    set({ oneShots: live.filter((_, i) => i !== idx) });
    return true;
  },
}));
