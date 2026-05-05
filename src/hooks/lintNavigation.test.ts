/**
 * Tests for lintNavigation
 *
 * Covers `scrollToSelectedDiagnostic`, `clearPendingLintScroll`, and
 * `consumePendingLintScroll`. The functions are plain helpers shared by
 * keyboard shortcut and menu event handlers; a regression silently breaks
 * "Go to next/previous lint" navigation, so each branch needs explicit
 * coverage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LintDiagnostic } from "@/lib/lintEngine/types";

const mockScrollIntoView = vi.fn(() => ({ __tag: "scroll-effect" }));
vi.mock("@codemirror/view", () => ({
  EditorView: {
    scrollIntoView: (...args: unknown[]) => mockScrollIntoView(...args),
  },
}));

const mockLintState: {
  diagnosticsByTab: Record<string, LintDiagnostic[]>;
  selectedIndexByTab: Record<string, number>;
} = {
  diagnosticsByTab: {},
  selectedIndexByTab: {},
};
vi.mock("@/stores/lintStore", () => ({
  useLintStore: { getState: () => mockLintState },
}));

interface MockSourceView {
  dispatch: ReturnType<typeof vi.fn>;
  state: { doc: { length: number } };
  dom: { isConnected: boolean };
}
const mockActiveEditorState: { activeSourceView: MockSourceView | null } = {
  activeSourceView: null,
};
vi.mock("@/stores/activeEditorStore", () => ({
  useActiveEditorStore: { getState: () => mockActiveEditorState },
}));

const mockEditorState: { sourceMode: boolean } = { sourceMode: false };
vi.mock("@/stores/editorStore", () => ({
  useEditorStore: { getState: () => mockEditorState },
}));

const mockGetCurrentWindowLabel = vi.fn(() => "main");
vi.mock("@/utils/workspaceStorage", () => ({
  getCurrentWindowLabel: () => mockGetCurrentWindowLabel(),
}));

const mockCleanupBeforeModeSwitch = vi.fn();
vi.mock("@/utils/modeSwitchCleanup", () => ({
  cleanupBeforeModeSwitch: () => mockCleanupBeforeModeSwitch(),
}));

const mockToggleSourceModeWithCheckpoint = vi.fn();
vi.mock("@/hooks/useUnifiedHistory", () => ({
  toggleSourceModeWithCheckpoint: (label: string) =>
    mockToggleSourceModeWithCheckpoint(label),
}));

import {
  scrollToSelectedDiagnostic,
  clearPendingLintScroll,
  consumePendingLintScroll,
} from "./lintNavigation";

function makeDiag(overrides: Partial<LintDiagnostic> = {}): LintDiagnostic {
  return {
    id: "rule-1-1",
    ruleId: "rule",
    severity: "warning",
    messageKey: "lint.x",
    messageParams: {},
    line: 1,
    column: 1,
    offset: 5,
    uiHint: "exact",
    ...overrides,
  };
}

function makeSourceView(opts: {
  docLength: number;
  isConnected?: boolean;
}): MockSourceView {
  return {
    dispatch: vi.fn(),
    state: { doc: { length: opts.docLength } },
    dom: { isConnected: opts.isConnected ?? true },
  };
}

beforeEach(() => {
  mockScrollIntoView.mockReset().mockReturnValue({ __tag: "scroll-effect" });
  mockGetCurrentWindowLabel.mockReset().mockReturnValue("main");
  mockCleanupBeforeModeSwitch.mockReset();
  mockToggleSourceModeWithCheckpoint.mockReset();
  mockLintState.diagnosticsByTab = {};
  mockLintState.selectedIndexByTab = {};
  mockActiveEditorState.activeSourceView = null;
  mockEditorState.sourceMode = false;
  // Drain any pending scrolls left over from previous tests
  ["t1", "t2"].forEach(clearPendingLintScroll);
});

describe("scrollToSelectedDiagnostic", () => {
  it("returns without dispatching when no diagnostics entry exists for the tab", () => {
    scrollToSelectedDiagnostic("t1");

    expect(mockScrollIntoView).not.toHaveBeenCalled();
    expect(mockToggleSourceModeWithCheckpoint).not.toHaveBeenCalled();
    expect(mockCleanupBeforeModeSwitch).not.toHaveBeenCalled();
  });

  it("returns without dispatching when diagnostics array is empty", () => {
    mockLintState.diagnosticsByTab = { t1: [] };

    scrollToSelectedDiagnostic("t1");

    expect(mockScrollIntoView).not.toHaveBeenCalled();
    expect(mockToggleSourceModeWithCheckpoint).not.toHaveBeenCalled();
  });

  it("returns without dispatching when selected index is out of range", () => {
    mockLintState.diagnosticsByTab = { t1: [makeDiag()] };
    mockLintState.selectedIndexByTab = { t1: 99 };

    scrollToSelectedDiagnostic("t1");

    expect(mockScrollIntoView).not.toHaveBeenCalled();
    expect(mockToggleSourceModeWithCheckpoint).not.toHaveBeenCalled();
  });

  it("dispatches a scrollIntoView effect in source mode and clamps offset to doc length", () => {
    const view = makeSourceView({ docLength: 10 });
    mockActiveEditorState.activeSourceView = view;
    mockEditorState.sourceMode = true;
    mockLintState.diagnosticsByTab = {
      t1: [makeDiag({ offset: 100 })],
    };
    mockLintState.selectedIndexByTab = { t1: 0 };

    scrollToSelectedDiagnostic("t1");

    expect(mockScrollIntoView).toHaveBeenCalledTimes(1);
    expect(mockScrollIntoView).toHaveBeenCalledWith(10);
    expect(view.dispatch).toHaveBeenCalledTimes(1);
    expect(view.dispatch).toHaveBeenCalledWith({
      effects: { __tag: "scroll-effect" },
    });
    expect(mockToggleSourceModeWithCheckpoint).not.toHaveBeenCalled();
  });

  it("does not dispatch in source mode when the editor DOM is disconnected", () => {
    const view = makeSourceView({ docLength: 10, isConnected: false });
    mockActiveEditorState.activeSourceView = view;
    mockEditorState.sourceMode = true;
    mockLintState.diagnosticsByTab = {
      t1: [makeDiag({ offset: 5 })],
    };

    scrollToSelectedDiagnostic("t1");

    expect(view.dispatch).not.toHaveBeenCalled();
    expect(mockScrollIntoView).not.toHaveBeenCalled();
    expect(mockToggleSourceModeWithCheckpoint).not.toHaveBeenCalled();
  });

  it("WYSIWYG + sourceOnly diagnostic switches to source mode and queues the offset", () => {
    mockEditorState.sourceMode = false;
    mockLintState.diagnosticsByTab = {
      t1: [makeDiag({ offset: 42, uiHint: "sourceOnly" })],
    };

    scrollToSelectedDiagnostic("t1");

    expect(mockCleanupBeforeModeSwitch).toHaveBeenCalledTimes(1);
    expect(mockToggleSourceModeWithCheckpoint).toHaveBeenCalledTimes(1);
    expect(mockToggleSourceModeWithCheckpoint).toHaveBeenCalledWith("main");

    // First consume returns the queued offset; second returns undefined
    expect(consumePendingLintScroll("t1")).toBe(42);
    expect(consumePendingLintScroll("t1")).toBeUndefined();
  });

  it("WYSIWYG + non-sourceOnly diagnostic does nothing (PM decoration handles it)", () => {
    mockEditorState.sourceMode = false;
    mockLintState.diagnosticsByTab = {
      t1: [makeDiag({ uiHint: "exact" })],
    };

    scrollToSelectedDiagnostic("t1");

    expect(mockCleanupBeforeModeSwitch).not.toHaveBeenCalled();
    expect(mockToggleSourceModeWithCheckpoint).not.toHaveBeenCalled();
    expect(mockScrollIntoView).not.toHaveBeenCalled();
    expect(consumePendingLintScroll("t1")).toBeUndefined();
  });
});

describe("clearPendingLintScroll", () => {
  it("removes a queued scroll so subsequent consume returns undefined", () => {
    mockEditorState.sourceMode = false;
    mockLintState.diagnosticsByTab = {
      t1: [makeDiag({ offset: 7, uiHint: "sourceOnly" })],
    };

    scrollToSelectedDiagnostic("t1");

    clearPendingLintScroll("t1");

    expect(consumePendingLintScroll("t1")).toBeUndefined();
  });
});
