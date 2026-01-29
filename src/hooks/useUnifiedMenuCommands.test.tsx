import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useUnifiedMenuCommands } from "./useUnifiedMenuCommands";
import { performWysiwygToolbarAction } from "@/plugins/toolbarActions/wysiwygAdapter";
import { performSourceToolbarAction } from "@/plugins/toolbarActions/sourceAdapter";

type MenuEventHandler = (event: { payload: string }) => void;

const listeners = new Map<string, MenuEventHandler>();

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "main",
    listen: vi.fn((eventName: string, handler: MenuEventHandler) => {
      listeners.set(eventName, handler);
      return Promise.resolve(() => {});
    }),
  }),
}));

vi.mock("@/stores/featureFlagsStore", () => ({
  FEATURE_FLAGS: { UNIFIED_MENU_DISPATCHER: true },
}));

let sourceMode = false;
vi.mock("@/stores/viewSettingsStore", () => {
  const useViewSettingsStore = (selector?: (state: { sourceMode: boolean }) => unknown) => {
    const state = { sourceMode };
    return selector ? selector(state) : state;
  };
  useViewSettingsStore.getState = () => ({ sourceMode });
  return { useViewSettingsStore };
});

let activeWysiwygEditor: { view: object } | null = null;
let activeSourceView: object | null = null;
vi.mock("@/stores/activeEditorStore", () => ({
  useActiveEditorStore: {
    getState: () => ({
      activeWysiwygEditor,
      activeSourceView,
    }),
  },
}));

vi.mock("@/stores/sourceCursorContextStore", () => ({
  useSourceCursorContextStore: {
    getState: () => ({ context: null }),
  },
}));

vi.mock("@/plugins/toolbarActions/multiSelectionContext", () => ({
  getWysiwygMultiSelectionContext: () => null,
  getSourceMultiSelectionContext: () => null,
}));

vi.mock("@/utils/focusGuard", () => ({
  shouldBlockMenuAction: () => false,
}));

vi.mock("@/utils/imeGuard", () => ({
  runOrQueueCodeMirrorAction: (_view: unknown, fn: () => void) => fn(),
}));

vi.mock("@/plugins/toolbarActions/wysiwygAdapter", () => ({
  performWysiwygToolbarAction: vi.fn(() => true),
  setWysiwygHeadingLevel: vi.fn(() => true),
}));

vi.mock("@/plugins/toolbarActions/sourceAdapter", () => ({
  performSourceToolbarAction: vi.fn(() => true),
  setSourceHeadingLevel: vi.fn(() => true),
}));

vi.mock("@/plugins/actions/actionRegistry", () => ({
  MENU_TO_ACTION: {
    "menu:bold": { actionId: "bold" },
    "menu:italic": { actionId: "italic" },
  },
  ACTION_DEFINITIONS: {
    bold: {
      id: "bold",
      label: "Bold",
      category: "formatting",
      supports: { wysiwyg: false, source: true },
    },
    italic: {
      id: "italic",
      label: "Italic",
      category: "formatting",
      supports: { wysiwyg: true, source: true },
    },
  },
  getHeadingLevelFromParams: () => 1,
}));

function TestHarness() {
  useUnifiedMenuCommands();
  return null;
}

describe("useUnifiedMenuCommands", () => {
  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();
    sourceMode = false;
    activeWysiwygEditor = null;
    activeSourceView = null;
  });

  it("routes menu actions to WYSIWYG adapter when in WYSIWYG mode", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:italic")).toBe(true));

    listeners.get("menu:italic")?.({ payload: "main" });

    expect(performWysiwygToolbarAction).toHaveBeenCalledWith(
      "italic",
      expect.objectContaining({ surface: "wysiwyg" })
    );
    expect(performSourceToolbarAction).not.toHaveBeenCalled();
  });

  it("routes menu actions to Source adapter when in Source mode", async () => {
    sourceMode = true;
    activeSourceView = {};

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:italic")).toBe(true));

    listeners.get("menu:italic")?.({ payload: "main" });

    expect(performSourceToolbarAction).toHaveBeenCalledWith(
      "italic",
      expect.objectContaining({ surface: "source" })
    );
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("blocks actions that are unsupported for the current mode", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:bold")).toBe(true));

    listeners.get("menu:bold")?.({ payload: "main" });

    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
    expect(performSourceToolbarAction).not.toHaveBeenCalled();
  });
});
