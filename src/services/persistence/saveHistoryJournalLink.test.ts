// @vitest-environment node
// WI-AL1.4 — the save pipeline hands the journal revision of an MCP save to Version History, so the "mcp" snapshot links to it; manual and auto snapshots carry no link
import { beforeEach, describe, expect, it, vi } from "vitest";

const createSnapshot = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined));
vi.mock("@/services/history/historyOperations", () => ({ createSnapshot }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: { warning: vi.fn() } }));

import { useSettingsStore } from "@/stores/settingsStore";
import { recordHistorySnapshot } from "./saveHistorySnapshot";

const REV = "0190d3c4-0000-7000-8000-000000000002";

beforeEach(() => {
  createSnapshot.mockClear();
  useSettingsStore.setState((state) => ({ general: { ...state.general, historyEnabled: true } }));
});

describe("recordHistorySnapshot journal link", () => {
  it("passes the revision for an mcp snapshot", async () => {
    await recordHistorySnapshot("/w/a.md", "c", "mcp", REV);
    expect(createSnapshot.mock.calls[0]?.[4]).toBe(REV);
  });

  it.each(["manual", "auto"] as const)("passes no link for a %s snapshot", async (saveType) => {
    await recordHistorySnapshot("/w/a.md", "c", saveType, REV);
    expect(createSnapshot.mock.calls[0]?.[4]).toBeNull();
  });

  it("passes no link when the save was not journaled", async () => {
    await recordHistorySnapshot("/w/a.md", "c", "mcp", null);
    expect(createSnapshot.mock.calls[0]?.[4]).toBeNull();
  });
});
