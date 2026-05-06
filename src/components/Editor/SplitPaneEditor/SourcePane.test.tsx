// WI-1A.4 — SourcePane skeleton tests.
//
// Covers the source-text rendering host. CodeMirror itself is heavy and
// requires DOM extension globals; smoke-tests verify the slot wires the
// document content + format and exposes the CodeMirror container.

import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormatConfig } from "@/lib/formats/types";
import { SourcePane } from "./SourcePane";

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: Object.assign(
    (selector?: (state: unknown) => unknown) => {
      const state = {
        documents: {
          "tab-1": { content: "hello world", filePath: "/foo.txt" },
        },
        getDocument: () => ({ content: "hello world", filePath: "/foo.txt" }),
      };
      return selector ? selector(state) : state;
    },
    {
      getState: () => ({
        documents: {
          "tab-1": { content: "hello world", filePath: "/foo.txt" },
        },
        getDocument: () => ({ content: "hello world", filePath: "/foo.txt" }),
      }),
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
});
