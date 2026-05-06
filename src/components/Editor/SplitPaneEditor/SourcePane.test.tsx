// WI-1A.4 — SourcePane skeleton tests.
//
// Covers the source-text rendering host. CodeMirror itself is heavy and
// requires DOM extension globals; smoke-tests verify the slot wires the
// document content + format and exposes the CodeMirror container.

import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormatConfig } from "@/lib/formats/types";
import { SourcePane } from "./SourcePane";

// Mutable mock state so individual tests can simulate async store
// updates that arrive after the editor has mounted.
const mockState = {
  documents: {
    "tab-1": { content: "hello world", filePath: "/foo.txt" as string | null },
  } as Record<string, { content: string; filePath: string | null }>,
  getDocument: (id: string) => mockState.documents[id],
  setContent: vi.fn((id: string, content: string) => {
    mockState.documents[id] = { ...mockState.documents[id], content };
  }),
};

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: Object.assign(
    (selector?: (state: unknown) => unknown) => {
      return selector ? selector(mockState) : mockState;
    },
    {
      getState: () => mockState,
      subscribe: () => () => {},
    },
  ),
}));

const txtConfig: FormatConfig = {
  id: "txt",
  nameI18nKey: "format.txt",
  extensions: ["txt"],
  kind: "split-pane",
  adapters: {
    saveDialogFilters: [{ name: "Plain", extensions: ["txt"] }],
    untitledExtension: "txt",
    searchAdapter: "codemirror",
    readOnlyDefault: false,
    closeSavePolicy: "markdown-default",
    menuPolicy: {
      sourceWysiwygToggle: false,
      cjkFormatActions: false,
      insertBlockActions: false,
      paragraphFormatting: false,
    },
  },
};

describe("SourcePane", () => {
  afterEach(() => cleanup());

  it("renders a source-pane container", () => {
    render(
      <SourcePane tabId="tab-1" formatId="txt" formatConfig={txtConfig} />,
    );
    expect(screen.getByTestId("source-pane")).toBeInTheDocument();
  });

  it("exposes data-format-id and data-tab-id on the container", () => {
    render(
      <SourcePane tabId="tab-1" formatId="txt" formatConfig={txtConfig} />,
    );
    const pane = screen.getByTestId("source-pane");
    expect(pane).toHaveAttribute("data-format-id", "txt");
    expect(pane).toHaveAttribute("data-tab-id", "tab-1");
  });

  it("uses role=textbox for the inner editor surface for accessibility", () => {
    render(
      <SourcePane tabId="tab-1" formatId="txt" formatConfig={txtConfig} />,
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("renders content from the document store on mount", () => {
    const { container } = render(
      <SourcePane tabId="tab-1" formatId="txt" formatConfig={txtConfig} />,
    );
    // CodeMirror renders content into .cm-content (per CodeMirror v6 DOM).
    const cm = container.querySelector(".cm-content");
    expect(cm).not.toBeNull();
    expect(cm?.textContent ?? "").toContain("hello world");
  });

  it("re-syncs the editor when the store content updates after mount", async () => {
    mockState.documents["tab-1"] = {
      content: "initial",
      filePath: "/foo.txt",
    };
    const { container, rerender } = render(
      <SourcePane tabId="tab-1" formatId="txt" formatConfig={txtConfig} />,
    );
    expect(container.querySelector(".cm-content")?.textContent ?? "").toContain(
      "initial",
    );
    // Simulate the file load completing — store content updates after mount.
    mockState.documents["tab-1"] = {
      content: "loaded after mount",
      filePath: "/foo.txt",
    };
    rerender(
      <SourcePane tabId="tab-1" formatId="txt" formatConfig={txtConfig} />,
    );
    expect(container.querySelector(".cm-content")?.textContent ?? "").toContain(
      "loaded after mount",
    );
  });
});
