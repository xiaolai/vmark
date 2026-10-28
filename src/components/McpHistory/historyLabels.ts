/**
 * History labels — the words the history panel shows for who made a
 * revision, what kind it is, what each live hunk is, its state and where,
 * and why a change's automatic revert is blocked.
 *
 * Key decisions:
 *   - The four principal states read differently and carry their own tone:
 *     only a recognized provider is named, and a client's self-chosen
 *     display name is shown as a detail, never as the provider.
 *   - Break reasons are a closed set, labelled exhaustively. Origins are
 *     open-ended strings: a known prefix (before `:`) is named, anything
 *     else falls back to "another source" with the raw origin kept, so a
 *     new origin never renders as an empty or wrong label.
 *   - Pure: the translator is a parameter, so the labels are unit-tested
 *     without React.
 *   - A journal time is a number the journal wrote; one outside what a
 *     `Date` can hold (a corrupted record) has no time rather than throwing
 *     out of the render and taking the panel down.
 *
 * @coordinates-with services/agentJournal/journalActor.ts — the actor shape
 * @coordinates-with services/agentJournal/docHistoryClient.ts — kinds, live and blocked hunks
 * @module components/McpHistory/historyLabels
 */

import type { TFunction } from "i18next";
import type { JournalActor } from "@/services/agentJournal/journalActor";
import type { HunkKind, LiveHunk, RevisionKind } from "@/services/agentJournal/docHistoryClient";
import type { BreakReason } from "@/services/agentJournal/provenance/accumulator";

/** The real statusbar `t`; a structural stand-in is not satisfied by i18next's overloads. */
export type Translate = TFunction<"statusbar">;

/** How an actor is shown; `tone` styles each principal state apart. */
export interface ActorParts {
  tone: "provider" | "anonymous" | "unrecognized" | "ambiguous" | "human" | "legacy" | "system";
  who: string;
  details: string[];
}

const PRINCIPAL_KEYS = {
  anonymous: "mcpHistoryPrincipalAnonymous",
  unrecognized: "mcpHistoryPrincipalUnrecognized",
  ambiguous: "mcpHistoryPrincipalAmbiguous",
} as const;

export function actorParts(actor: JournalActor, t: Translate): ActorParts {
  switch (actor.type) {
    case "human":
      return { tone: "human", who: t("mcpHistoryActorYou"), details: [] };
    case "legacy":
      return { tone: "legacy", who: t("mcpHistoryActorLegacy"), details: [] };
    case "system":
      return {
        tone: "system",
        who: actor.reason === "autosave" ? t("mcpHistoryActorAutosave") : t("mcpHistoryActorSystem", { reason: actor.reason }),
        details: [],
      };
    case "mcp": {
      const p = actor.principal;
      const details = [t("mcpHistoryConnection", { id: actor.connectionId })];
      if (actor.sessionLabel) details.push(t("mcpHistorySession", { label: actor.sessionLabel }));
      if (actor.displayName) details.push(t("mcpHistoryClientName", { name: actor.displayName }));
      if (p.state === "provider") return { tone: "provider", who: p.provider, details };
      return { tone: p.state, who: t(PRINCIPAL_KEYS[p.state]), details };
    }
  }
}

const REASON_KEYS: Record<BreakReason, string> = {
  snapshotOnly: "mcpHistoryReasonSnapshotOnly",
  wholeDocumentWrite: "mcpHistoryReasonWholeDocumentWrite",
  externalReload: "mcpHistoryReasonExternalReload",
  restore: "mcpHistoryReasonRestore",
  uncertifiedRange: "mcpHistoryReasonUncertifiedRange",
  capOverflow: "mcpHistoryReasonCapOverflow",
  unclosedEpoch: "mcpHistoryReasonUnclosedEpoch",
  parentMismatch: "mcpHistoryReasonParentMismatch",
};

export function breakReasonLabel(reason: BreakReason, t: Translate): string {
  return t(REASON_KEYS[reason]);
}

const ORIGIN_KEYS: ReadonlyMap<string, string> = new Map([
  ["wysiwyg", "mcpHistoryOriginWysiwyg"],
  ["source", "mcpHistoryOriginSource"],
  ["store", "mcpHistoryOriginStore"],
  ["save", "mcpHistoryOriginSave"],
  ["freeze", "mcpHistoryOriginTracking"],
  ["accumulator", "mcpHistoryOriginTracking"],
  ["concurrentObservation", "mcpHistoryOriginConcurrent"],
  ["gap", "mcpHistoryOriginGap"],
  ["mcp", "mcpHistoryOriginMcp"],
  ["watcher", "mcpHistoryOriginWatcher"],
  ["restart", "mcpHistoryOriginRestart"],
  ["restore", "mcpHistoryOriginRestore"],
]);

export function originLabel(origin: string, t: Translate): string {
  const key = ORIGIN_KEYS.get(origin.split(":")[0]);
  return key ? t(key) : t("mcpHistoryOriginOther", { origin });
}

const KIND_KEYS: Record<RevisionKind, string> = {
  controlled: "mcpHistoryKindControlled",
  observed: "mcpHistoryKindObserved",
  concurrent: "mcpHistoryKindConcurrent",
  gap: "mcpHistoryKindGap",
  tombstone: "mcpHistoryKindTombstone",
};

export function kindLabel(kind: RevisionKind, t: Translate): string {
  return t(KIND_KEYS[kind]);
}

const HUNK_KIND_KEYS: Record<HunkKind, string> = {
  change: "mcpHistoryHunkKindChange",
  largeChange: "mcpHistoryHunkKindLargeChange",
  tooComplex: "mcpHistoryHunkKindTooComplex",
  restore: "mcpHistoryHunkKindRestore",
};

const HUNK_STATE_KEYS: Record<LiveHunk["state"], string> = {
  pending: "mcpHistoryHunkStatePending",
  kept: "mcpHistoryHunkStateKept",
  reverted: "mcpHistoryHunkStateReverted",
  conflicted: "mcpHistoryHunkStateConflicted",
  superseded: "mcpHistoryHunkStateSuperseded",
  resolvedByHumanEdit: "mcpHistoryHunkStateResolvedByHumanEdit",
  settled: "mcpHistoryHunkStateSettled",
};

/**
 * A live hunk's kind, state and span in the revision that made it, as the
 * journal persisted them. The span is in UTF-16 units, not characters, so
 * it is worded as a neutral position.
 */
export function hunkLabel(hunk: LiveHunk, t: Translate): string {
  return t("mcpHistoryHunk", {
    kind: t(HUNK_KIND_KEYS[hunk.kind]),
    state: t(HUNK_STATE_KEYS[hunk.state]),
    from: hunk.targetRange.from,
    to: hunk.targetRange.to,
  });
}

/** The furthest a `Date` reaches either side of the epoch, in milliseconds (ECMA-262 TimeClip). */
const MAX_DATE_MS = 8_640_000_000_000_000;
const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" });

/** A journal time as `<time dateTime>` and readable text, or null when no `Date` can hold it. */
export function historyTime(ms: number): { iso: string; text: string } | null {
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_DATE_MS) return null;
  return { iso: new Date(ms).toISOString(), text: timeFormat.format(ms) };
}
