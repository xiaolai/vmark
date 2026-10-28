// @vitest-environment node
/**
 * One classification of a history restore's outcome, shared by the panel's
 * two restore buttons: a clean apply (changed or not), or the problem to
 * report and its tone — and, apart from either, whether the history record
 * of an apply was confirmed on disk (an unconfirmed one adds a warning).
 */
import { describe, it, expect } from "vitest";
import type { HistoryRestoreOutcome } from "@/services/agentJournal/historyRestore";
import { classifyRestore, NOT_DURABLE_KEY } from "../restoreVerdict";

const applied = (changed: boolean, durable = true): HistoryRestoreOutcome => ({ status: "applied", durable, changed, resolves: null });

describe("classifyRestore", () => {
  it.each([
    ["a changed apply", applied(true), { kind: "applied", changed: true, durable: true }],
    ["an apply that changed nothing", applied(false), { kind: "applied", changed: false, durable: true }],
    ["an apply whose record was not confirmed on disk", applied(true, false), { kind: "applied", changed: true, durable: false }],
    [
      "an apply that threw after changing the buffer",
      { status: "appliedWithError", error: new Error("x"), durable: true, changed: true, resolves: null },
      { kind: "problem", tone: "warning", key: "mcpHistoryRestoreAppliedWithError", durable: true },
    ],
    [
      "an apply that threw, its record not confirmed on disk",
      { status: "appliedWithError", error: new Error("x"), durable: false, changed: true, resolves: null },
      { kind: "problem", tone: "warning", key: "mcpHistoryRestoreAppliedWithError", durable: false },
    ],
    [
      "an apply that could not be confirmed",
      { status: "recoveryRequired", error: new Error("x") },
      { kind: "problem", tone: "error", key: "mcpHistoryRestoreRecoveryRequired", durable: true },
    ],
    [
      "a refusal",
      { status: "refused", refusal: { kind: "NOT_FOUND" } },
      { kind: "problem", tone: "error", key: "mcpHistoryRestoreFailed", durable: true },
    ],
    ["an abort", { status: "aborted", reason: "closed" }, { kind: "problem", tone: "error", key: "mcpHistoryRestoreFailed", durable: true }],
    ["no outcome (the restore threw)", null, { kind: "problem", tone: "error", key: "mcpHistoryRestoreFailed", durable: true }],
  ])("%s", (_name, outcome, expected) => {
    expect(classifyRestore(outcome as HistoryRestoreOutcome | null)).toEqual(expected);
  });
});

it("names the warning an unconfirmed record adds", () => {
  expect(NOT_DURABLE_KEY).toBe("mcpHistoryNotDurable");
});
