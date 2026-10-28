/**
 * Who asked for a save, and how it ended.
 *
 * Purpose: the vocabulary `saveToPath` and its callers share. Its own module
 * so the MCP bridge, which renders an outcome for an AI client, depends on the
 * types without depending on the pipeline's implementation file for them.
 *
 * Key decisions:
 *   - The failure carries FACTS, not prose. The human pipeline answers a
 *     failure with a localized toast; the MCP bridge answers it with an
 *     English diagnostic for an AI client. One message baked in here would be
 *     wrong for one of them, so each audience renders the reason itself.
 *   - An MCP save always names its tool AND the client that asked for it (the
 *     request's attribution). The provenance capture needs both: a save origin
 *     of "mcp" without them would have nothing to record, or would record it
 *     under the wrong client.
 *
 * @coordinates-with saveToPath.ts — produces the outcome
 * @coordinates-with services/mcpBridge/v2/bridgeSave.ts — renders it for MCP clients
 * @coordinates-with services/agentJournal/saveJournal.ts — the `journaled` flag
 * @module services/persistence/saveOutcome
 */
import type { FileOwnershipClaim } from "@/services/workspaces/fileOwnership";
import type { McpAttribution } from "@/services/mcpBridge/types";
import type { Journaled } from "@/services/agentJournal/journalClient";
import type { SaveTargetReservation } from "./saveTargetClaim";
import type { McpReadBatch } from "@/services/coherence/mcpReads";

/**
 * Who asked for the save. It decides the feedback (only a manual save may
 * toast), the history snapshot kind, and whose provenance is recorded.
 */
export type SaveOrigin =
  | { saveType: "manual" | "auto" }
  | { saveType: "mcp"; toolName: string; actor: McpAttribution };

/** Why a save wrote nothing. */
export type SaveFailure =
  /** Another open tab holds unsaved changes to the same file. */
  | { reason: "ownership-conflict"; conflicts: FileOwnershipClaim[] }
  /** The file's folder no longer exists; the document is now marked missing. */
  | { reason: "parent-missing"; dir: string }
  /** The write itself was rejected; `error` is the raw rejection. */
  | { reason: "write-failed"; error: unknown }
  /** The caller's admission check refused the path at the save's turn;
   *  `detail` is the refusal as the check reported it. */
  | { reason: "path-denied"; detail: string }
  /** A no-replace save found a file already at `path` when it published;
   *  that file was kept and nothing was written. */
  | { reason: "target-exists"; path: string }
  /** A save asked for after this one already reached the file at `path`;
   *  this older one wrote nothing. `newest`: the order of the save the file
   *  holds, as Rust recorded it (`null` when Rust named its floor, or no
   *  order a webview could issue). */
  | { reason: "superseded"; path: string; newest: number | null };

/**
 * How a save ended. `written` is the exact text that reached the disk;
 * `journaled` how far the agent edit journal got recording it (`yes`,
 * `pending` behind another write, `no` not recorded). The journal revision
 * itself stays inside the pipeline, which hands it to the history snapshot.
 */
export type SaveOutcome =
  | { ok: true; written: string; journaled: Journaled }
  | ({ ok: false } & SaveFailure);

/**
 * How an MCP request that was admitted before its first await enters the
 * pipeline: the place it reserved in the document's save order at admission
 * (activated only once its write succeeds), the check it still has to pass
 * (its path guard), run at the save's turn in the per-path queue, and whether
 * the write must refuse rather than replace a file already at the path
 * (Save As to a destination that is not the tab's own file). `reads` is the
 * read batch the request detached at admission: the save records it as the
 * write's inputs, and never gives it back — its owner decides that.
 */
export interface McpSaveAdmission {
  reservation?: SaveTargetReservation | undefined;
  admit?: (() => Promise<SaveFailure | null>) | undefined;
  noReplace?: boolean | undefined;
  reads?: McpReadBatch | undefined;
}
