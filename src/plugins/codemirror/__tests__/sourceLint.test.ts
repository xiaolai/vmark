/**
 * Tests for sourceLint.ts — CodeMirror lint extension helpers.
 *
 * Covers: diagnosticToCM, createSourceLintExtension, triggerLintRefresh
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LintSource } from "@codemirror/lint";
import type { ViewUpdate } from "@codemirror/view";

// ── Capture the linter callback and forceLinting calls ───────────────────────
let capturedLintSource: LintSource | null = null;
const mockForceLinting = vi.fn();

vi.mock("@codemirror/lint", () => ({
  linter: vi.fn((source: LintSource) => {
    capturedLintSource = source;
    return { extension: "linter-ext" };
  }),
  forceLinting: (...args: unknown[]) => mockForceLinting(...args),
}));

// ── Capture the updateListener callback ──────────────────────────────────────
let capturedUpdateCallback: ((update: ViewUpdate) => void) | null = null;

vi.mock("@codemirror/view", () => ({
  EditorView: {
    updateListener: {
      of: vi.fn((cb: (update: ViewUpdate) => void) => {
        capturedUpdateCallback = cb;
        return { extension: "updateListener-ext" };
      }),
    },
  },
}));

// ── Mock lintStore ───────────────────────────────────────────────────────────
const mockClearDiagnostics = vi.fn();
vi.mock("@/stores/documentStore", () => ({
  useLintStore: {
    getState: vi.fn(() => ({
      diagnosticsByTab: {},
      clearDiagnostics: mockClearDiagnostics,
    })),
    subscribe: vi.fn(() => () => {}),
  },
}));

// ── Mock activeEditorStore ───────────────────────────────────────────────────
const mockActiveEditorGetState = vi.fn(() => ({
  active: { activeSourceView: null },
}));
vi.mock("@/stores/editorStore", () => ({
  useEditorStore: {
    getState: (...args: unknown[]) => mockActiveEditorGetState(...args),
  },
}));

import {
  diagnosticToCM,
  createSourceLintExtension,
  triggerLintRefresh,
} from "../sourceLint";
import { useLintStore } from "@/stores/documentStore";
import type { LintDiagnostic } from "@/lib/lintEngine/types";

function makeDiag(overrides: Partial<LintDiagnostic> = {}): LintDiagnostic {
  return {
    id: "E01-1-1",
    ruleId: "E01",
    severity: "error",
    messageKey: "lint.E01",
    messageParams: {},
    line: 1,
    column: 1,
    offset: 0,
    uiHint: "exact",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedLintSource = null;
  capturedUpdateCallback = null;
  mockActiveEditorGetState.mockReturnValue({ active: { activeSourceView: null } });
});

// ─── diagnosticToCM ──────────────────────────────────────────────────────────

describe("diagnosticToCM", () => {
  it("maps offset 0 with no endOffset to from=0, to=0", () => {
    const d = makeDiag({ offset: 0 });
    const result = diagnosticToCM(100, d);
    expect(result.from).toBe(0);
    expect(result.to).toBe(0);
  });

  it("maps offset and endOffset correctly", () => {
    const d = makeDiag({ offset: 5, endOffset: 10 });
    const result = diagnosticToCM(100, d);
    expect(result.from).toBe(5);
    expect(result.to).toBe(10);
  });

  it("clamps offset to docLength", () => {
    const d = makeDiag({ offset: 200, endOffset: 210 });
    const result = diagnosticToCM(100, d);
    expect(result.from).toBe(100);
    expect(result.to).toBe(100);
  });

  it("ensures to >= from when endOffset < offset", () => {
    const d = makeDiag({ offset: 10, endOffset: 5 });
    const result = diagnosticToCM(100, d);
    // to should be max(5, 10) = 10
    expect(result.to).toBeGreaterThanOrEqual(result.from);
  });

  it("maps severity error correctly", () => {
    const d = makeDiag({ severity: "error" });
    const result = diagnosticToCM(100, d);
    expect(result.severity).toBe("error");
  });

  it("maps severity warning correctly", () => {
    const d = makeDiag({ severity: "warning" });
    const result = diagnosticToCM(100, d);
    expect(result.severity).toBe("warning");
  });

  it("translates messageKey to localized string", () => {
    const d = makeDiag({ messageKey: "lint.W03", messageParams: { ref: "foo" } });
    const result = diagnosticToCM(100, d);
    // i18n mock resolves keys to their English translation
    expect(result.message).toContain("definition");
  });

  it("handles docLength = 0 gracefully", () => {
    const d = makeDiag({ offset: 0 });
    const result = diagnosticToCM(0, d);
    expect(result.from).toBe(0);
    expect(result.to).toBe(0);
  });

  it("handles point diagnostic (no endOffset)", () => {
    const d = makeDiag({ offset: 42, endOffset: undefined });
    const result = diagnosticToCM(100, d);
    expect(result.from).toBe(42);
    expect(result.to).toBe(42);
  });
});

// ─── createSourceLintExtension ───────────────────────────────────────────────

describe("createSourceLintExtension", () => {
  it("returns an array of two extensions", () => {
    const extensions = createSourceLintExtension("tab-1");
    expect(extensions).toHaveLength(2);
  });

  it("linter source returns empty array when no diagnostics for the tab", () => {
    vi.mocked(useLintStore.getState).mockReturnValue({
      diagnosticsByTab: {},
      clearDiagnostics: mockClearDiagnostics,
    } as unknown as ReturnType<typeof useLintStore.getState>);

    createSourceLintExtension("tab-1");
    expect(capturedLintSource).toBeTruthy();

    const mockView = { state: { doc: { length: 100 } } } as unknown as Parameters<LintSource>[0];
    const result = capturedLintSource!(mockView);
    expect(result).toEqual([]);
  });

  it("linter source returns empty array when diagnostics array is empty", () => {
    vi.mocked(useLintStore.getState).mockReturnValue({
      diagnosticsByTab: { "tab-1": [] },
      clearDiagnostics: mockClearDiagnostics,
    } as unknown as ReturnType<typeof useLintStore.getState>);

    createSourceLintExtension("tab-1");
    expect(capturedLintSource).toBeTruthy();

    const mockView = { state: { doc: { length: 100 } } } as unknown as Parameters<LintSource>[0];
    const result = capturedLintSource!(mockView);
    expect(result).toEqual([]);
  });

  it("linter source maps diagnostics through diagnosticToCM", () => {
    const diags: LintDiagnostic[] = [
      makeDiag({ offset: 5, endOffset: 10, severity: "error" }),
      makeDiag({ id: "W03-2-1", ruleId: "W03", offset: 20, endOffset: 30, severity: "warning" }),
    ];
    vi.mocked(useLintStore.getState).mockReturnValue({
      diagnosticsByTab: { "tab-2": diags },
      clearDiagnostics: mockClearDiagnostics,
    } as unknown as ReturnType<typeof useLintStore.getState>);

    createSourceLintExtension("tab-2");
    expect(capturedLintSource).toBeTruthy();

    const mockView = { state: { doc: { length: 50 } } } as unknown as Parameters<LintSource>[0];
    const result = capturedLintSource!(mockView) as Array<{ from: number; to: number; severity: string }>;
    expect(result).toHaveLength(2);
    expect(result[0].from).toBe(5);
    expect(result[0].to).toBe(10);
    expect(result[0].severity).toBe("error");
    expect(result[1].from).toBe(20);
    expect(result[1].to).toBe(30);
    expect(result[1].severity).toBe("warning");
  });

  it("linter source clamps diagnostics to doc length", () => {
    const diags: LintDiagnostic[] = [
      makeDiag({ offset: 200, endOffset: 210 }),
    ];
    vi.mocked(useLintStore.getState).mockReturnValue({
      diagnosticsByTab: { "tab-3": diags },
      clearDiagnostics: mockClearDiagnostics,
    } as unknown as ReturnType<typeof useLintStore.getState>);

    createSourceLintExtension("tab-3");
    const mockView = { state: { doc: { length: 50 } } } as unknown as Parameters<LintSource>[0];
    const result = capturedLintSource!(mockView) as Array<{ from: number; to: number }>;
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe(50);
    expect(result[0].to).toBe(50);
  });

  it("linter source only reads diagnostics for the given tabId", () => {
    const diagsA: LintDiagnostic[] = [makeDiag({ offset: 1, endOffset: 2 })];
    const diagsB: LintDiagnostic[] = [
      makeDiag({ offset: 10, endOffset: 20 }),
      makeDiag({ offset: 30, endOffset: 40 }),
    ];
    vi.mocked(useLintStore.getState).mockReturnValue({
      diagnosticsByTab: { "tab-a": diagsA, "tab-b": diagsB },
      clearDiagnostics: mockClearDiagnostics,
    } as unknown as ReturnType<typeof useLintStore.getState>);

    createSourceLintExtension("tab-a");
    const mockView = { state: { doc: { length: 100 } } } as unknown as Parameters<LintSource>[0];
    const result = capturedLintSource!(mockView) as Array<{ from: number }>;
    // Should only return tab-a's single diagnostic, not tab-b's two
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe(1);
  });

  it("clearOnEdit calls clearDiagnostics when document changes", () => {
    createSourceLintExtension("tab-clear");
    expect(capturedUpdateCallback).toBeTruthy();

    capturedUpdateCallback!({ docChanged: true } as unknown as ViewUpdate);
    expect(mockClearDiagnostics).toHaveBeenCalledWith("tab-clear");
  });

  it("clearOnEdit does not call clearDiagnostics when document has not changed", () => {
    createSourceLintExtension("tab-no-change");
    expect(capturedUpdateCallback).toBeTruthy();

    capturedUpdateCallback!({ docChanged: false } as unknown as ViewUpdate);
    expect(mockClearDiagnostics).not.toHaveBeenCalled();
  });
});

// ─── triggerLintRefresh ──────────────────────────────────────────────────────

describe("triggerLintRefresh", () => {
  it("calls forceLinting when active source view exists with connected DOM", () => {
    const mockView = { dom: { isConnected: true } };
    mockActiveEditorGetState.mockReturnValue({ active: { activeSourceView: mockView } });

    triggerLintRefresh();
    expect(mockForceLinting).toHaveBeenCalledWith(mockView);
  });

  it("does not call forceLinting when no active source view", () => {
    mockActiveEditorGetState.mockReturnValue({ active: { activeSourceView: null } });

    triggerLintRefresh();
    expect(mockForceLinting).not.toHaveBeenCalled();
  });

  it("does not call forceLinting when DOM is disconnected", () => {
    const mockView = { dom: { isConnected: false } };
    mockActiveEditorGetState.mockReturnValue({ active: { activeSourceView: mockView } });

    triggerLintRefresh();
    expect(mockForceLinting).not.toHaveBeenCalled();
  });

  it("does not call forceLinting when dom is null", () => {
    const mockView = { dom: null };
    mockActiveEditorGetState.mockReturnValue({ active: { activeSourceView: mockView } });

    triggerLintRefresh();
    expect(mockForceLinting).not.toHaveBeenCalled();
  });

  it("does not call forceLinting when dom is undefined", () => {
    const mockView = { dom: undefined };
    mockActiveEditorGetState.mockReturnValue({ active: { activeSourceView: mockView } });

    triggerLintRefresh();
    expect(mockForceLinting).not.toHaveBeenCalled();
  });

  it("does not throw when view is undefined", () => {
    mockActiveEditorGetState.mockReturnValue({ active: { activeSourceView: undefined } });

    expect(() => triggerLintRefresh()).not.toThrow();
    expect(mockForceLinting).not.toHaveBeenCalled();
  });
});
