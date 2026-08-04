/**
 * Per-item salvage of persisted hot-exit session payloads (WI-3).
 *
 * Purpose: turn an untrusted payload into either a restorable session, a
 * clean "nothing to restore", or an "invalid" verdict — WITHOUT ever throwing
 * and without silently discarding bytes. Anything that fails its schema is
 * returned as a quarantined entry (the exact raw value, untouched) so the
 * caller can preserve it on disk before restore proceeds.
 *
 * Key decisions:
 *   - Empty ≠ corrupt: null/undefined and `{}` mean "no session" (clean
 *     empty restore, nothing quarantined).
 *   - Valid payloads pass through by IDENTITY — the input object itself is
 *     returned, so a healthy restore is byte-identical to the pre-WI-3 path.
 *   - Salvage granularity: per window, then per tab. A corrupt tab never
 *     takes its siblings down; a corrupt window never takes the session down.
 *   - A non-empty windows array with ZERO survivors is invalid: dispatching
 *     an eviscerated session would let a later successful restore clear the
 *     session file while all real content only exists in the quarantine.
 *
 * @coordinates-with sessionQuarantine.ts — persists quarantined entries
 * @coordinates-with restoreDispatch.ts — re-exports this as the read boundary
 * @module services/persistence/hotExit/sessionSalvage
 */
import type { SessionData } from "./types";
import {
  schemaReason,
  sessionEnvelopeSchema,
  tabStateSchema,
  windowEnvelopeSchema,
  workspaceStateSchema,
} from "./sessionSchema";

/** A payload fragment that failed validation, preserved exactly as received. */
export interface QuarantinedEntry {
  /** Location in the payload, e.g. `"$"`, `"windows[0].tabs[1]"`. */
  path: string;
  /** The exact raw value that failed — never rewritten, never dropped. */
  raw: unknown;
  /** Human-readable schema failure summary. */
  reason: string;
}

export type SessionSalvageResult =
  | { status: "empty" }
  | { status: "invalid"; quarantined: QuarantinedEntry[] }
  | { status: "ok"; session: SessionData; quarantined: QuarantinedEntry[] };

/** `{}` (a session file holding an empty object) means "no session", not corruption. */
function isEmptyPayload(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  return (
    typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length === 0
  );
}

/**
 * Validate and salvage a persisted session payload. Never throws.
 * Valid input is returned by identity; partially corrupt input is rebuilt
 * from the surviving original entries with the failures quarantined.
 */
export function salvageSessionPayload(raw: unknown): SessionSalvageResult {
  if (isEmptyPayload(raw)) return { status: "empty" };

  const envelope = sessionEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return {
      status: "invalid",
      quarantined: [{ path: "$", raw, reason: schemaReason(envelope.error) }],
    };
  }

  const quarantined: QuarantinedEntry[] = [];
  const rawSession = raw as { windows: unknown[]; workspace?: unknown };

  const windows: unknown[] = [];
  rawSession.windows.forEach((rawWindow, i) => {
    const win = windowEnvelopeSchema.safeParse(rawWindow);
    if (!win.success) {
      quarantined.push({
        path: `windows[${i}]`,
        raw: rawWindow,
        reason: schemaReason(win.error),
      });
      return;
    }
    const rawTabs = (rawWindow as { tabs: unknown[] }).tabs;
    const tabs: unknown[] = [];
    rawTabs.forEach((rawTab, j) => {
      const tab = tabStateSchema.safeParse(rawTab);
      if (!tab.success) {
        quarantined.push({
          path: `windows[${i}].tabs[${j}]`,
          raw: rawTab,
          reason: schemaReason(tab.error),
        });
        return;
      }
      tabs.push(rawTab); // the ORIGINAL tab object — schemas validate, never rewrite
    });
    windows.push(
      tabs.length === rawTabs.length ? rawWindow : { ...(rawWindow as object), tabs },
    );
  });

  if (rawSession.windows.length > 0 && windows.length === 0) {
    return { status: "invalid", quarantined };
  }

  // Workspace is salvaged independently: an unusable workspace payload is
  // quarantined and replaced with null rather than blocking tab restore.
  let workspaceInvalid = false;
  if (rawSession.workspace !== undefined) {
    const workspace = workspaceStateSchema.safeParse(rawSession.workspace);
    if (!workspace.success) {
      quarantined.push({
        path: "workspace",
        raw: rawSession.workspace,
        reason: schemaReason(workspace.error),
      });
      workspaceInvalid = true;
    }
  }

  if (quarantined.length === 0) {
    return { status: "ok", session: raw as SessionData, quarantined };
  }
  const session = {
    ...(raw as object),
    windows,
    ...(workspaceInvalid ? { workspace: null } : {}),
  } as SessionData;
  return { status: "ok", session, quarantined };
}
