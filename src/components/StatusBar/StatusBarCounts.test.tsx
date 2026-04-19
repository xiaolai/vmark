import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock document state hooks
let mockContent = "";
let mockSelectedText = "";
vi.mock("@/hooks/useDocumentState", () => ({
  useDocumentContent: () => mockContent,
  useDocumentSelectedText: () => mockSelectedText,
}));

// Mock alfaaz to avoid native module issues in test
vi.mock("alfaaz", () => ({
  countWords: (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  },
}));

import { StatusBarCounts } from "./StatusBarCounts";

beforeEach(() => {
  mockContent = "";
  mockSelectedText = "";
});

describe("StatusBarCounts", () => {
  it("renders 0 words and 0 chars for empty content", () => {
    mockContent = "";
    render(<StatusBarCounts />);
    expect(screen.getByText("0 words")).toBeInTheDocument();
    expect(screen.getByText("0 chars")).toBeInTheDocument();
  });

  it("renders word and char counts for plain text", () => {
    mockContent = "hello world";
    render(<StatusBarCounts />);
    expect(screen.getByText("2 words")).toBeInTheDocument();
    expect(screen.getByText("10 chars")).toBeInTheDocument();
  });

  it("strips markdown before counting", () => {
    mockContent = "# Heading\n\n**bold text**";
    render(<StatusBarCounts />);
    // "Heading" + "bold text" = 3 words
    expect(screen.getByText("3 words")).toBeInTheDocument();
  });

  it("renders correct char count excluding whitespace", () => {
    mockContent = "a b c";
    render(<StatusBarCounts />);
    // 3 non-whitespace chars
    expect(screen.getByText("3 chars")).toBeInTheDocument();
  });

  it("renders spans with status-item class", () => {
    mockContent = "test";
    render(<StatusBarCounts />);
    const wordSpan = screen.getByText(/words/);
    const charSpan = screen.getByText(/chars/);
    expect(wordSpan.className).toBe("status-item");
    expect(charSpan.className).toBe("status-item");
  });

  it("handles whitespace-only content", () => {
    mockContent = "   \n\n   ";
    render(<StatusBarCounts />);
    expect(screen.getByText("0 words")).toBeInTheDocument();
    expect(screen.getByText("0 chars")).toBeInTheDocument();
  });

  it("handles single word content", () => {
    mockContent = "hello";
    render(<StatusBarCounts />);
    expect(screen.getByText("1 words")).toBeInTheDocument();
    expect(screen.getByText("5 chars")).toBeInTheDocument();
  });

  it("strips code blocks before counting", () => {
    mockContent = "before\n```js\nconst x = 1;\n```\nafter";
    render(<StatusBarCounts />);
    // Only "before" and "after" remain
    expect(screen.getByText("2 words")).toBeInTheDocument();
  });

  it("handles markdown links", () => {
    mockContent = "[click here](https://example.com)";
    render(<StatusBarCounts />);
    // "click here" = 2 words
    expect(screen.getByText("2 words")).toBeInTheDocument();
    // "clickhere" = 9 chars
    expect(screen.getByText("9 chars")).toBeInTheDocument();
  });

  describe("with selection", () => {
    it("shows selected/total when selection is non-empty", () => {
      mockContent = "alpha beta gamma delta";
      mockSelectedText = "alpha beta";
      render(<StatusBarCounts />);
      expect(screen.getByText("2 / 4 words")).toBeInTheDocument();
      expect(screen.getByText("9 / 19 chars")).toBeInTheDocument();
    });

    it("falls back to total-only when selection is empty", () => {
      mockContent = "alpha beta gamma";
      mockSelectedText = "";
      render(<StatusBarCounts />);
      expect(screen.getByText("3 words")).toBeInTheDocument();
      expect(screen.getByText("14 chars")).toBeInTheDocument();
    });

    it("falls back to total-only when selection is whitespace", () => {
      mockContent = "alpha beta";
      mockSelectedText = "   \n\n  ";
      render(<StatusBarCounts />);
      expect(screen.getByText("2 words")).toBeInTheDocument();
    });

    it("treats selection as present even when only markdown syntax is selected", () => {
      // Selecting just the bold markers around no text — stripped is empty,
      // but the user clearly intended to select something.
      mockContent = "alpha **bold** gamma";
      mockSelectedText = "**";
      render(<StatusBarCounts />);
      // Should still show selection mode (0 selected, total)
      expect(screen.getByText("0 / 3 words")).toBeInTheDocument();
    });

    it("strips markdown from selected text before counting", () => {
      mockContent = "intro **bold word** outro";
      mockSelectedText = "**bold word**";
      render(<StatusBarCounts />);
      // selection: "bold word" -> 2 words, 8 non-ws chars;
      // total: "intro bold word outro" -> 4 words, 18 non-ws chars
      expect(screen.getByText("2 / 4 words")).toBeInTheDocument();
      expect(screen.getByText("8 / 18 chars")).toBeInTheDocument();
    });
  });
});
