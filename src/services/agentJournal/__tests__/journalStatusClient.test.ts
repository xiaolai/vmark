// @vitest-environment node
// WI-AL1.7 — the journal's health for the history panel's status line (`agent_journal_status`): starting, ready (with its generation, read-only and degraded flags) and failed (with the reason); whether live updates are starting, ready or failed, kept apart from the writer's health; a ready journal's own error (a legacy import that failed), an identity index that could not open, and the startup retention pass's warnings and errors are kept, never dropped as healthy; a malformed reply (an unknown or missing live-update state, a malformed retention summary included) is refused as JOURNAL_UNAVAILABLE; the count of selection certificates that fell back to a barrier is required and read (WI-AL2.1c); so are the page registrations refused at the per-window cap and the cleanup-worker runs lost, which a status must never drop as healthy; a pin breakdown that is an array is malformed
import { describe, it, expect, vi, beforeEach } from "vitest";

import { invoke } from "@tauri-apps/api/core";
import { readJournalHealth } from "../journalStatusClient";

const invokeMock = vi.mocked(invoke);
const base = { phase: "ready", generation: "9", readOnly: false, degraded: false, liveUpdates: "ready", identity: "durable", truncatedTailBytes: 0, uncommittedAtStart: 0, uncertifiedFallbacks: 0, registrationCapRefusals: 0, cleanupWorkerFailures: 0 };

beforeEach(() => invokeMock.mockReset());

describe("readJournalHealth", () => {
  it("reads a healthy journal", async () => {
    invokeMock.mockResolvedValueOnce(base);
    expect(await readJournalHealth()).toEqual({ phase: "ready", generation: "9", readOnly: false, degraded: false, liveUpdates: "ready", identity: "durable", error: null, identityError: null, retention: null, uncertifiedFallbacks: 0, registrationCapRefusals: 0, cleanupWorkerFailures: 0 });
    expect(invokeMock).toHaveBeenCalledWith("agent_journal_status", {});
  });

  it("reads the count of selection certificates that fell back to a barrier", async () => {
    invokeMock.mockResolvedValueOnce({ ...base, uncertifiedFallbacks: 3 });
    expect(await readJournalHealth()).toMatchObject({ uncertifiedFallbacks: 3 });
  });

  it("reads the registration cap refusals and the cleanup-worker failures", async () => {
    invokeMock.mockResolvedValueOnce({ ...base, registrationCapRefusals: 2, cleanupWorkerFailures: 1 });
    expect(await readJournalHealth()).toMatchObject({ registrationCapRefusals: 2, cleanupWorkerFailures: 1 });
  });

  it("reads a degraded and a read-only journal", async () => {
    invokeMock.mockResolvedValueOnce({ ...base, degraded: true, readOnly: true });
    expect(await readJournalHealth()).toMatchObject({ degraded: true, readOnly: true });
  });

  it("reads a journal that failed to start, with its reason", async () => {
    invokeMock.mockResolvedValueOnce({ phase: "failed", readOnly: false, degraded: false, liveUpdates: "failed", identity: "sessionOnly", truncatedTailBytes: 0, uncommittedAtStart: 0, uncertifiedFallbacks: 0, registrationCapRefusals: 0, cleanupWorkerFailures: 0, error: "disk full" });
    expect(await readJournalHealth()).toEqual({ phase: "failed", generation: null, readOnly: false, degraded: false, liveUpdates: "failed", identity: "sessionOnly", error: "disk full", identityError: null, retention: null, uncertifiedFallbacks: 0, registrationCapRefusals: 0, cleanupWorkerFailures: 0 });
  });

  it("reads a journal still starting", async () => {
    invokeMock.mockResolvedValueOnce({ phase: "starting", readOnly: false, degraded: false, liveUpdates: "starting", identity: "sessionOnly", truncatedTailBytes: 0, uncommittedAtStart: 0, uncertifiedFallbacks: 0, registrationCapRefusals: 0, cleanupWorkerFailures: 0 });
    expect(await readJournalHealth()).toMatchObject({ phase: "starting", generation: null });
  });

  it.each(["starting", "ready", "failed"] as const)("reads live updates %s beside a healthy writer", async (liveUpdates) => {
    invokeMock.mockResolvedValueOnce({ ...base, liveUpdates });
    expect(await readJournalHealth()).toMatchObject({ phase: "ready", degraded: false, liveUpdates });
  });

  const gc = {
    collected: 3,
    warnings: [
      { doc: "0f8fad5b-d9cb-469f-a165-70867728950e", kind: "nearCap", limit: "revisions", used: 820, cap: 1000, pinnedBy: { blobRoots: 2 } },
      { doc: null, kind: "pinnedOverCap", limit: "totalBytes", used: 3000, cap: 2048, pinnedBy: {} },
    ],
    blobError: "IO: blob sweep failed",
  };

  it("keeps a ready journal's error, the identity index error and the retention summary", async () => {
    invokeMock.mockResolvedValueOnce({ ...base, error: "legacy import failed", identity: "disabled", identityError: "index unreadable", gc });
    expect(await readJournalHealth()).toMatchObject({
      phase: "ready",
      error: "legacy import failed",
      identity: "disabled",
      identityError: "index unreadable",
      retention: {
        collected: 3,
        warnings: [
          { doc: "0f8fad5b-d9cb-469f-a165-70867728950e", kind: "nearCap", limit: "revisions", used: 820, cap: 1000, pinnedBy: { blobRoots: 2 } },
          { doc: null, kind: "pinnedOverCap", limit: "totalBytes", used: 3000, cap: 2048, pinnedBy: {} },
        ],
        deferred: null,
        blobError: "IO: blob sweep failed",
        error: null,
      },
    });
  });

  it.each([
    ["durable", undefined],
    ["sessionOnly", undefined],
    ["disabled", "identity index line 2 is unreadable"],
    ["disabled", "version 99/later is incompatible"],
  ] as const)("reads identity %s with error %s", async (identity, identityError) => {
    invokeMock.mockResolvedValueOnce({ ...base, identity, identityError });
    expect(await readJournalHealth()).toMatchObject({ identity, identityError: identityError ?? null });
  });

  it("keeps a retention pass that could not run", async () => {
    invokeMock.mockResolvedValueOnce({ ...base, gc: { collected: 0, warnings: [], error: "JOURNAL_IO: disk" } });
    expect((await readJournalHealth()).retention).toEqual({ collected: 0, warnings: [], deferred: null, blobError: null, error: "JOURNAL_IO: disk" });
  });

  it.each([
    ["no reply", undefined],
    ["an empty identity error", { ...base, identityError: "" }],
    ["a missing identity mode", { ...base, identity: undefined }],
    ["an unknown identity mode", { ...base, identity: "readOnly" }],
    ["a boolean identity mode", { ...base, identity: true }],
    ["durable identity with an identity error", { ...base, identity: "durable", identityError: "IO: x" }],
    ["session-only identity with an identity error", { ...base, identity: "sessionOnly", identityError: "IO: x" }],
    ["disabled identity without its reason", { ...base, identity: "disabled" }],
    ["a retention summary without warnings", { ...base, gc: { collected: 0 } }],
    ["an unknown warning kind", { ...base, gc: { ...gc, warnings: [{ ...gc.warnings[0], kind: "overCap" }] } }],
    ["an unknown warning limit", { ...base, gc: { ...gc, warnings: [{ ...gc.warnings[0], limit: "bytes" }] } }],
    ["a negative usage", { ...base, gc: { ...gc, warnings: [{ ...gc.warnings[0], used: -1 }] } }],
    ["a non-numeric pin count", { ...base, gc: { ...gc, warnings: [{ ...gc.warnings[0], pinnedBy: { x: "1" } }] } }],
    ["a missing live-update state", { ...base, liveUpdates: undefined }],
    ["an unknown live-update state", { ...base, liveUpdates: "maybe" }],
    ["a boolean live-update state", { ...base, liveUpdates: true }],
    ["an unknown phase", { ...base, phase: "sleeping" }],
    ["a missing fallback count", { ...base, uncertifiedFallbacks: undefined }],
    ["a negative fallback count", { ...base, uncertifiedFallbacks: -1 }],
    ["a string fallback count", { ...base, uncertifiedFallbacks: "1" }],
    ["a missing registration cap count", { ...base, registrationCapRefusals: undefined }],
    ["a negative registration cap count", { ...base, registrationCapRefusals: -1 }],
    ["a missing cleanup failure count", { ...base, cleanupWorkerFailures: undefined }],
    ["a fractional cleanup failure count", { ...base, cleanupWorkerFailures: 0.5 }],
    ["an array of pin counts", { ...base, gc: { ...gc, warnings: [{ ...gc.warnings[0], pinnedBy: [] }] } }],
    ["a numeric generation", { ...base, generation: 9 }],
    ["a missing degraded flag", { ...base, degraded: undefined }],
    ["a ready journal without its generation", { ...base, generation: undefined }],
    ["a generation past u64::MAX", { ...base, generation: "18446744073709551616" }],
    ["a starting journal with a generation", { ...base, phase: "starting" }],
    ["a failed journal with a generation", { ...base, phase: "failed", error: "disk full" }],
  ])("refuses %s as JOURNAL_UNAVAILABLE", async (_label, reply) => {
    invokeMock.mockResolvedValueOnce(reply);
    await expect(readJournalHealth()).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });
});
