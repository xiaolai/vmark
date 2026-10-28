// WI-AL1.7 — the history status: a failed, read-only or behind journal, a queued record of this document, a save the history refused or did not answer in time (the deadline), changes whose automatic revert is blocked (provenance loss), and recording suspended because the document's identity could not be updated each show their own line; a healthy journal with nothing blocked shows nothing; a journal whose state cannot be read counts as unavailable; live updates that failed beside a recording journal get a warning (the panel polls instead), while starting live updates and a journal that never started say nothing more; page registrations refused at the per-window cap and cleanup-worker runs lost are each counted on their own warning line
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { JournalStatusNotice } from "../JournalStatusNotice";
import { journalStatusLines } from "../journalStatusLines";
import type { JournalHealth } from "@/services/agentJournal/journalStatusClient";
import type { DocumentHistory } from "@/services/agentJournal/docHistoryClient";

const healthy: JournalHealth = { phase: "ready", generation: "4", readOnly: false, degraded: false, liveUpdates: "ready", identity: "durable", error: null, identityError: null, retention: null, uncertifiedFallbacks: 0, registrationCapRefusals: 0, cleanupWorkerFailures: 0 };
const doc = (over: Partial<DocumentHistory> = {}): DocumentHistory => ({ generation: "4", head: null, rows: [], truncated: false, hunks: [], blocked: [], degraded: false, ...over });
const hunk = (id: string) => ({ hunkId: id, state: "pending" as const, reason: "restore" as const, origin: "restore", lastCertified: null, blockedAt: null, target: "r1" });

const base = { health: healthy, healthFailed: false, history: doc(), problem: null, unbound: false };

describe("journalStatusLines", () => {
  it("a healthy journal with nothing blocked has nothing to say", () => {
    expect(journalStatusLines(base)).toEqual([]);
  });

  it.each([
    ["failed start", { health: { ...healthy, phase: "failed" as const, error: null } }, "mcpHistoryStatusFailed"],
    ["failed start with a reason", { health: { ...healthy, phase: "failed" as const, error: "disk" } }, "mcpHistoryStatusFailedBecause"],
    ["unreadable state", { health: null, healthFailed: true }, "mcpHistoryStatusFailed"],
    ["read-only", { health: { ...healthy, readOnly: true } }, "mcpHistoryStatusReadOnly"],
    ["behind", { health: { ...healthy, degraded: true } }, "mcpHistoryStatusDegraded"],
    ["document queued", { history: doc({ degraded: true }) }, "mcpHistoryStatusDocQueued"],
    ["save queued", { problem: { kind: "queued" as const, code: null } }, "mcpHistoryStatusDocQueued"],
    ["save refused", { problem: { kind: "refused" as const, code: "JOURNAL_DEGRADED" } }, "mcpHistoryStatusRefused"],
    ["save deadline", { problem: { kind: "timeout" as const, code: "JOURNAL_TIMEOUT" } }, "mcpHistoryStatusTimeout"],
    ["live updates failed", { health: { ...healthy, liveUpdates: "failed" as const } }, "mcpHistoryStatusLiveUpdatesFailed"],
    ["blocked hunks", { history: doc({ blocked: [hunk("a"), hunk("b")] }) }, "mcpHistoryStatusBlocked"],
    ["identity not updated", { unbound: true }, "mcpHistoryStatusIdentityUnbound"],
    ["registrations refused at the cap", { health: { ...healthy, registrationCapRefusals: 3 } }, "mcpHistoryStatusRegistrationCapRefusals"],
    ["cleanup runs lost", { health: { ...healthy, cleanupWorkerFailures: 1 } }, "mcpHistoryStatusCleanupWorkerFailures"],
    ["edits recorded as whole-document changes", { health: { ...healthy, uncertifiedFallbacks: 2 } }, "mcpHistoryStatusUncertifiedFallbacks"],
  ])("%s has its own line", (_name, over, key) => {
    expect(journalStatusLines({ ...base, ...over }).map((l) => l.key)).toEqual([key]);
  });

  it("a queued document is said once, however it was learned", () => {
    const lines = journalStatusLines({ ...base, history: doc({ degraded: true }), problem: { kind: "queued", code: null } });
    expect(lines.map((l) => l.key)).toEqual(["mcpHistoryStatusDocQueued"]);
  });

  it("live updates still starting are not a problem", () => {
    expect(journalStatusLines({ ...base, health: { ...healthy, liveUpdates: "starting" } })).toEqual([]);
  });

  it("a journal that failed to start says only that, not that live updates failed", () => {
    const health = { ...healthy, phase: "failed" as const, generation: null, liveUpdates: "failed" as const, error: "disk" };
    expect(journalStatusLines({ ...base, health }).map((l) => l.key)).toEqual(["mcpHistoryStatusFailedBecause"]);
  });

  it("a starting journal is not reported as a problem", () => {
    expect(journalStatusLines({ ...base, health: { ...healthy, phase: "starting", generation: null } })).toEqual([]);
  });
});

describe("journalStatusLines — what failed beside a recording journal", () => {
  const retention = (over: Partial<NonNullable<JournalHealth["retention"]>> = {}) => ({
    collected: 0, warnings: [], deferred: null, blobError: null, error: null, ...over,
  });
  const warning = (kind: "nearCap" | "pinnedOverCap") => ({ doc: null, kind, limit: "totalBytes" as const, used: 9, cap: 10, pinnedBy: {} });

  it.each([
    ["a startup error", { error: "IMPORT: legacy journal unreadable" }, "mcpHistoryStatusStartupProblem", "IMPORT: legacy journal unreadable"],
    ["a deferred cleanup", { retention: retention({ deferred: "LOCKED: busy" }) }, "mcpHistoryStatusRetentionDeferred", "LOCKED: busy"],
    ["a blob sweep error", { retention: retention({ blobError: "IO: denied" }) }, "mcpHistoryStatusRetentionBlobError", "IO: denied"],
    ["a cleanup that could not run", { retention: retention({ error: "IO: gone" }) }, "mcpHistoryStatusRetentionFailed", "IO: gone"],
  ])("%s has its own line carrying the reason", (_name, over, key, detail) => {
    expect(journalStatusLines({ ...base, health: { ...healthy, ...over } })).toEqual([{ tone: "warning", key, values: { detail } }]);
  });

  it.each([
    ["an incompatible index", "version 99/later is incompatible"],
    ["an unreadable index", "identity index line 2 is unreadable"],
    ["an index that cannot open", "identity index I/O: denied"],
  ])("%s says recording is off, carrying the reason", (_name, detail) => {
    const health = { ...healthy, identity: "disabled" as const, identityError: detail };
    expect(journalStatusLines({ ...base, health })).toEqual([{ tone: "error", key: "mcpHistoryStatusIdentityDisabled", values: { detail } }]);
  });

  it("session-only identity before the index attaches says nothing", () => {
    expect(journalStatusLines({ ...base, health: { ...healthy, identity: "sessionOnly" } })).toEqual([]);
  });

  it("counts each kind of cap warning on its own line", () => {
    const health = { ...healthy, retention: retention({ warnings: [warning("nearCap"), warning("pinnedOverCap"), warning("nearCap")] }) };
    expect(journalStatusLines({ ...base, health })).toEqual([
      { tone: "warning", key: "mcpHistoryStatusRetentionNearCap", values: { count: 2 } },
      { tone: "warning", key: "mcpHistoryStatusRetentionPinnedOverCap", values: { count: 1 } },
    ]);
  });

  it("a clean retention pass that collected history has nothing to say", () => {
    expect(journalStatusLines({ ...base, health: { ...healthy, retention: retention({ collected: 12 }) } })).toEqual([]);
  });

  it("renders a reason inside its sentence", () => {
    render(<JournalStatusNotice {...base} health={{ ...healthy, identity: "disabled", identityError: "IO: denied" }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/recording is off.*identity index.*IO: denied/i);
  });

  it("renders why a journal failed to start", () => {
    render(<JournalStatusNotice {...base} health={{ ...healthy, phase: "failed", generation: null, error: "disk full" }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/not being recorded.*disk full/i);
  });
});

describe("JournalStatusNotice", () => {
  it("renders nothing when there is nothing to say", () => {
    const { container } = render(<JournalStatusNotice {...base} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says a refused save was not recorded, with its code", () => {
    render(<JournalStatusNotice {...base} problem={{ kind: "refused", code: "JOURNAL_DEGRADED" }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/not recorded.*JOURNAL_DEGRADED/i);
  });

  it("says a save the history did not answer in time was not recorded", () => {
    render(<JournalStatusNotice {...base} problem={{ kind: "timeout", code: "JOURNAL_TIMEOUT" }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/did not answer in time/i);
  });

  it("counts the changes whose automatic revert is blocked", () => {
    render(<JournalStatusNotice {...base} history={doc({ blocked: [hunk("a"), hunk("b")] })} />);
    expect(screen.getByRole("status")).toHaveTextContent(/automatic revert is blocked: 2/i);
  });

  it("says when live updates are off and the panel polls instead", () => {
    render(<JournalStatusNotice {...base} health={{ ...healthy, liveUpdates: "failed" }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/live updates.*unavailable/i);
  });

  it("says when the history is unavailable", () => {
    render(<JournalStatusNotice {...base} health={null} healthFailed />);
    expect(screen.getByRole("status")).toHaveTextContent(/not being recorded/i);
  });
});
