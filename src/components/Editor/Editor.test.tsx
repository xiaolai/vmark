import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Editor } from "./Editor";
import { WindowProvider } from "@/contexts/WindowContext";

type Selector<T> = (state: T) => unknown;

function createZustandMock<T extends object>(state: T) {
  const store = ((selector?: Selector<T>) => {
    if (typeof selector === "function") {
      return selector(state);
    }
    return state;
  }) as unknown as {
    (selector: Selector<T>): unknown;
    getState: () => T;
    subscribe: (listener: (state: T, prev: T) => void) => () => void;
  };

  store.getState = () => state;
  store.subscribe = () => () => {};

  return store;
}

// Mock Tauri APIs
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));

// Mock useEditorStore
vi.mock("@/stores/editorStore", () => {
  const state = {
    content: "",
    setContent: vi.fn(),
    sourceMode: false,
    focusModeEnabled: false,
    typewriterModeEnabled: false,
  };

  return { useEditorStore: createZustandMock(state) };
});

vi.mock("@/stores/documentStore", () => {
  const mockDocumentStore = {
    documents: { "tab-1": { documentId: 1, content: "", isDirty: false, filePath: null } },
    getDocument: () => ({ content: "", isDirty: false, filePath: null }),
    initDocument: vi.fn(),
  };

  return { useDocumentStore: createZustandMock(mockDocumentStore) };
});

vi.mock("@/stores/tabStore", () => {
  const mockTabStore = {
    tabs: { main: [{ id: "tab-1", filePath: null, title: "Untitled", isPinned: false }] },
    activeTabId: { main: "tab-1" },
    getTabsByWindow: () => [{ id: "tab-1", filePath: null, title: "Untitled", isPinned: false }],
    createTab: vi.fn(() => "tab-1"),
  };

  return { useTabStore: createZustandMock(mockTabStore) };
});

function renderWithProvider(ui: React.ReactElement) {
  return render(<WindowProvider>{ui}</WindowProvider>);
}

describe("Editor", () => {
  it("renders the editor container", () => {
    renderWithProvider(<Editor />);

    const container = document.querySelector(".editor-container");
    expect(container).toBeInTheDocument();
  });

  it("renders the editor content area", () => {
    renderWithProvider(<Editor />);

    const content = document.querySelector(".editor-content");
    expect(content).toBeInTheDocument();
  });
});
