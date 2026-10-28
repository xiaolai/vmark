/**
 * Journal status client — the agent edit journal's health for the history
 * panel's status line (`agent_journal_status`): still starting, ready, or
 * failed to start, whether it is read-only or degraded, and whether its
 * changes reach the windows as live updates.
 *
 * Key decisions:
 *   - The reply is checked like every journal reply (`journalIpc.ts`); an
 *     unknown phase is malformed, never read as healthy.
 *   - `liveUpdates` is required and checked the same way: the status comes
 *     from the same build, so a missing value is malformed, never read as
 *     live. It is kept apart from the phase — a recording journal can have
 *     no live updates.
 *   - `identity` (durable, session-only, disabled) is required and checked
 *     the same way, and must agree with `identityError`: exactly a disabled
 *     identity names its reason.
 *   - Every failure the status carries is kept, checked like the rest: a
 *     ready journal's own `error` (a legacy import that failed), the
 *     identity index error, and the startup retention pass (`gc`: cap
 *     warnings, a deferred or failed pass, a blob sweep error), so none
 *     reads as healthy. The counts of the startup report stay with their
 *     own readers.
 *   - `uncertifiedFallbacks` is required and checked the same way: the
 *     selection certificates that fell back to a whole-document barrier
 *     since the journal opened. So are `registrationCapRefusals` and
 *     `cleanupWorkerFailures` (page registrations refused at the per-window
 *     cap, cleanup-worker runs lost, both since launch): dropping them would
 *     read a refusing or leaking journal as healthy.
 *   - A pin breakdown is a record of counts; an array is malformed.
 *
 * @coordinates-with src-tauri/src/agent_journal/service.rs — `AgentJournalStatus`
 * @module services/agentJournal/journalStatusClient
 */

import { callJournalBound, isDecimal, isObject, isString, malformed } from "./journalIpc";

const PHASES = ["starting", "ready", "failed"] as const;
type JournalPhase = (typeof PHASES)[number];
const isPhase = (v: unknown): v is JournalPhase => PHASES.some((p) => p === v);
const LIVE_UPDATES = ["starting", "ready", "failed"] as const;
type LiveUpdates = (typeof LIVE_UPDATES)[number];
const isLiveUpdates = (v: unknown): v is LiveUpdates => LIVE_UPDATES.some((l) => l === v);

const IDENTITY_MODES = ["durable", "sessionOnly", "disabled"] as const;
type IdentityMode = (typeof IDENTITY_MODES)[number];
const isIdentityMode = (v: unknown): v is IdentityMode => IDENTITY_MODES.some((m) => m === v);

const WARNING_KINDS = ["nearCap", "pinnedOverCap"] as const;
const isWarningKind = (v: unknown): v is (typeof WARNING_KINDS)[number] => WARNING_KINDS.some((k) => k === v);
const LIMITS = ["revisions", "docBytes", "totalBytes"] as const;
const isLimit = (v: unknown): v is (typeof LIMITS)[number] => LIMITS.some((l) => l === v);
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const optionalString = (v: unknown): v is string | undefined => v === undefined || isString(v);
const isCountRecord = (v: unknown): v is Record<string, number> => isObject(v) && !Array.isArray(v) && Object.values(v).every(isCount);

/** A retention cap warning from the startup pass; `doc` is `null` for the global byte cap. */
interface JournalRetentionWarning {
  doc: string | null;
  kind: (typeof WARNING_KINDS)[number];
  limit: (typeof LIMITS)[number];
  used: number;
  cap: number;
  /** What holds the retained history, by pin reason. */
  pinnedBy: Record<string, number>;
}

/** The startup retention pass: what it collected, its warnings, and why it was deferred or failed. */
interface JournalRetention {
  collected: number;
  warnings: JournalRetentionWarning[];
  deferred: string | null;
  blobError: string | null;
  /** The pass could not run, as `CODE: message`. */
  error: string | null;
}

export interface JournalHealth {
  phase: JournalPhase;
  generation: string | null;
  /** Written by a newer VMark: nothing is recorded. */
  readOnly: boolean;
  /**
   * A write failed ambiguously (agent edits refused until restart), or a
   * document's degraded queue holds records not yet on disk.
   */
  degraded: boolean;
  /** Whether changes in any window arrive as events; otherwise poll. */
  liveUpdates: LiveUpdates;
  /** Why the journal failed to start, or (ready) what failed while it started. */
  error: string | null;
  /**
   * How document identity is held: session-only until the index attaches
   * (or when the journal never started), durable once it attaches, disabled
   * when it could not be used (recording is off).
   */
  identity: IdentityMode;
  /** Why identity is disabled; set exactly when it is. */
  identityError: string | null;
  /** The startup retention pass, when it ran or tried to. */
  retention: JournalRetention | null;
  /** Selection certificates recorded as a whole-document barrier instead, since the journal opened. */
  uncertifiedFallbacks: number;
  /** Page registrations refused at the per-window cap since launch: agent edits there were refused. */
  registrationCapRefusals: number;
  /** Cleanup-worker runs lost to a failed start or a panic since launch. */
  cleanupWorkerFailures: number;
}

function parseWarning(w: unknown): JournalRetentionWarning | null {
  if (!isObject(w)) return null;
  const { doc, kind, limit, used, cap, pinnedBy } = w;
  if (!(doc === null || isString(doc)) || !isWarningKind(kind) || !isLimit(limit) || !isCount(used) || !isCount(cap) || !isCountRecord(pinnedBy)) {
    return null;
  }
  return { doc, kind, limit, used, cap, pinnedBy: { ...pinnedBy } };
}

/** The `gc` summary; `undefined` when absent, `null` when malformed. */
function parseRetention(gc: unknown): JournalRetention | null | undefined {
  if (gc === undefined) return undefined;
  if (!isObject(gc) || !isCount(gc.collected) || !Array.isArray(gc.warnings)) return null;
  if (!optionalString(gc.deferred) || !optionalString(gc.blobError) || !optionalString(gc.error)) return null;
  const warnings = gc.warnings.map(parseWarning);
  if (warnings.some((w) => w === null)) return null;
  return {
    collected: gc.collected,
    warnings: warnings as JournalRetentionWarning[],
    deferred: gc.deferred ?? null,
    blobError: gc.blobError ?? null,
    error: gc.error ?? null,
  };
}

const COMMAND = "agent_journal_status";

/**
 * The journal's health. A generation comes exactly with `ready`: only an
 * opened journal has one. Rejects with a `JournalRefusal`.
 */
export async function readJournalHealth(): Promise<JournalHealth> {
  const r = await callJournalBound(COMMAND, {});
  const retention = isObject(r) ? parseRetention(r.gc) : null;
  if (
    !isObject(r) ||
    !isPhase(r.phase) ||
    (r.phase === "ready" ? !isDecimal(r.generation) : r.generation !== undefined) ||
    typeof r.readOnly !== "boolean" ||
    typeof r.degraded !== "boolean" ||
    !isLiveUpdates(r.liveUpdates) ||
    !optionalString(r.error) ||
    !optionalString(r.identityError) ||
    !isIdentityMode(r.identity) ||
    (r.identity === "disabled") !== (r.identityError !== undefined) ||
    retention === null ||
    !isCount(r.uncertifiedFallbacks) ||
    !isCount(r.registrationCapRefusals) ||
    !isCount(r.cleanupWorkerFailures)
  ) {
    throw malformed(COMMAND);
  }
  return {
    phase: r.phase,
    generation: isDecimal(r.generation) ? r.generation : null,
    readOnly: r.readOnly,
    degraded: r.degraded,
    liveUpdates: r.liveUpdates,
    error: r.error ?? null,
    identity: r.identity,
    identityError: r.identityError ?? null,
    retention: retention ?? null,
    uncertifiedFallbacks: r.uncertifiedFallbacks,
    registrationCapRefusals: r.registrationCapRefusals,
    cleanupWorkerFailures: r.cleanupWorkerFailures,
  };
}
