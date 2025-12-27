import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Editor } from "./Editor";

// Mock useEditorStore
vi.mock("@/stores/editorStore", () => ({
  useEditorStore: vi.fn((selector) => {
    const state = {
      content: "",
      setContent: vi.fn(),
    };
    return selector(state);
  }),
}));

describe("Editor", () => {
  it("renders the editor container", () => {
    render(<Editor />);

    const container = document.querySelector(".editor-container");
    expect(container).toBeInTheDocument();
  });

  it("renders the editor content area", () => {
    render(<Editor />);

    const content = document.querySelector(".editor-content");
    expect(content).toBeInTheDocument();
  });
});
