// @vitest-environment node
// Behaviour of the `lint.*` command set after its extraction from
// viewCommands.ts. `lint.next` / `lint.prev` previously had no behavioural
// test — only their presence in the id list — so a move that swapped the two
// directions, or dropped the scroll-to-diagnostic call, would have gone
// unnoticed. The lint store runs for real (three seeded diagnostics), so these
// assert the selection actually moves, including the wrap at each end.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { scrollToSelectedDiagnostic, runActiveLint, getActiveTabId } = vi.hoisted(() => ({
  scrollToSelectedDiagnostic: vi.fn(),
  runActiveLint: vi.fn(),
  getActiveTabId: vi.fn(),
}));

vi.mock("@/services/lint/lintNavigation", () => ({ scrollToSelectedDiagnostic }));
vi.mock("@/services/lint/runActiveLint", () => ({ runActiveLint }));
vi.mock("@/services/navigation/activeDocument", () => ({ getActiveTabId }));

import { registerLintCommands, __resetLintCommandsRegistration } from "./lintCommands";
import { executeCommand, getCommand, _resetCommandBus } from "./CommandBus";
import { useLintStore } from "@/stores/documentStore";

const TAB = "tab-1";

/** Index the commands are expected to move. */
function selected(tabId = TAB): number | undefined {
  return useLintStore.getState().selectedIndexByTab[tabId];
}

function seedDiagnostics(count: number, tabId = TAB): void {
  useLintStore.setState({
    diagnosticsByTab: {
      [tabId]: Array.from({ length: count }, (_, i) => ({
        line: i + 1,
        column: 1,
        rule: `MD00${i + 1}`,
        message: `problem ${i + 1}`,
        severity: "warning" as const,
      })),
    },
    selectedIndexByTab: { [tabId]: 0 },
  });
}

beforeEach(() => {
  _resetCommandBus();
  __resetLintCommandsRegistration();
  registerLintCommands();
  vi.clearAllMocks();
  useLintStore.setState({ diagnosticsByTab: {}, selectedIndexByTab: {} });
  getActiveTabId.mockReturnValue(TAB);
});

describe("registerLintCommands", () => {
  it("registers the three lint commands under the lint category", () => {
    for (const id of ["lint.check", "lint.next", "lint.prev"]) {
      expect(getCommand(id)?.category).toBe("lint");
    }
  });

  it("is idempotent — a second call does not throw on duplicate ids", () => {
    expect(() => registerLintCommands()).not.toThrow();
  });
});

describe("lint.check", () => {
  it("runs the active linter for the calling window", async () => {
    await executeCommand("lint.check", undefined, { windowLabel: "w2" });
    expect(runActiveLint).toHaveBeenCalledWith("w2");
  });

  it("falls back to the main window when no label is supplied", async () => {
    await executeCommand("lint.check", undefined, {});
    expect(runActiveLint).toHaveBeenCalledWith("main");
  });
});

describe("lint.next / lint.prev", () => {
  beforeEach(() => seedDiagnostics(3));

  it("lint.next advances the selection and scrolls to it", async () => {
    await executeCommand("lint.next", undefined, { windowLabel: "main" });
    expect(selected()).toBe(1);
    expect(scrollToSelectedDiagnostic).toHaveBeenCalledWith(TAB);
  });

  it("lint.prev moves the selection BACKWARD, wrapping to the last", async () => {
    await executeCommand("lint.prev", undefined, { windowLabel: "main" });
    expect(selected()).toBe(2);
    expect(scrollToSelectedDiagnostic).toHaveBeenCalledWith(TAB);
  });

  it("lint.next wraps around at the end", async () => {
    for (let i = 0; i < 3; i++) {
      await executeCommand("lint.next", undefined, { windowLabel: "main" });
    }
    expect(selected()).toBe(0);
  });

  it("resolves the tab from the calling window, not a hardcoded one", async () => {
    await executeCommand("lint.next", undefined, { windowLabel: "w3" });
    expect(getActiveTabId).toHaveBeenCalledWith("w3");
  });

  it("does nothing when the window has no active tab", async () => {
    getActiveTabId.mockReturnValue(undefined);
    await executeCommand("lint.next", undefined, { windowLabel: "main" });
    await executeCommand("lint.prev", undefined, { windowLabel: "main" });
    expect(selected()).toBe(0);
    expect(scrollToSelectedDiagnostic).not.toHaveBeenCalled();
  });

  it("is a no-op when the tab has no diagnostics", async () => {
    useLintStore.setState({ diagnosticsByTab: {}, selectedIndexByTab: {} });
    await executeCommand("lint.next", undefined, { windowLabel: "main" });
    expect(selected()).toBeUndefined();
  });
});
