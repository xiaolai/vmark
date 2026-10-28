/**
 * Diff worker protocol — the messages between the budgeted diff on the main
 * thread and the diff worker, and the worker's request handler.
 *
 * Main → worker: `{ type: "diff", id, a, b }`. Worker → main: `{ type:
 * "ready" }` once warm, then per request `{ type: "result", id, changes }`
 * or `{ type: "failed", id, message }`. The handler never throws across the
 * boundary: a malformed request or a failing diff becomes a failed reply.
 * Replies are validated on receipt; anything malformed parses as null.
 *
 * @coordinates-with ./diffWorker.ts — the worker entry that runs `handleDiffRequest`
 * @coordinates-with ./budgetedDiff.ts — sends requests and parses replies
 * @module services/agentJournal/review/diffProtocol
 */

import { exactCanonicalDiff } from "./canonicalDiff";
import type { TextChange } from "./textChanges";

export interface DiffRequest {
  readonly type: "diff";
  readonly id: number;
  readonly a: string;
  readonly b: string;
}

export type DiffReply =
  | { readonly type: "ready" }
  | { readonly type: "result"; readonly id: number; readonly changes: TextChange[] }
  | { readonly type: "failed"; readonly id: number; readonly message: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isId = (v: unknown): v is number => Number.isSafeInteger(v);
const isOffset = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

function isChange(v: unknown): v is TextChange {
  return isRecord(v) && isOffset(v.fromA) && isOffset(v.toA) && isOffset(v.fromB) && isOffset(v.toB);
}

/** Run one request in the worker: the exact canonical diff, or a failed reply. */
export function handleDiffRequest(request: unknown): DiffReply {
  const id = isRecord(request) && isId(request.id) ? request.id : -1;
  if (!isRecord(request) || request.type !== "diff" || id < 0 || typeof request.a !== "string" || typeof request.b !== "string") {
    return { type: "failed", id, message: "malformed diff request" };
  }
  try {
    return { type: "result", id, changes: exactCanonicalDiff(request.a, request.b) };
  } catch (e) {
    return { type: "failed", id, message: e instanceof Error ? e.message : String(e) };
  }
}

/** A validated reply, or null when `data` is not one. Change lists are checked for shape only. */
export function parseDiffReply(data: unknown): DiffReply | null {
  if (!isRecord(data)) return null;
  if (data.type === "ready") return { type: "ready" };
  if (!isId(data.id)) return null;
  if (data.type === "result" && Array.isArray(data.changes) && data.changes.every(isChange)) {
    return { type: "result", id: data.id, changes: data.changes };
  }
  if (data.type === "failed" && typeof data.message === "string") return { type: "failed", id: data.id, message: data.message };
  return null;
}
