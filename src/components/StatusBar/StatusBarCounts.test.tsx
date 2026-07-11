import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Reactive document-state mock. The component is memo-wrapped with no props,
// so a bare rerender() bails out — updates must flow through a subscription,
// exactly like the real zustand-backed hooks. Assign docState.content /
// docState.selectedText before render, or call setMockDocState() inside the
// test to push an update into a mounted component.
const docState = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    content: "",
    selectedText: "",
    listeners,
    notify(): void {
      for (const listener of listeners) listener();
    },
  };
});
vi.mock("@/hooks/useDocumentState", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (cb: () => void): (() => void) => {
    docState.listeners.add(cb);
    return () => docState.listeners.delete(cb);
  };
  return {
    useDocumentContent: () => useSyncExternalStore(subscribe, () => docState.content),
    useDocumentSelectedText: () =>
      useSyncExternalStore(subscribe, () => docState.selectedText),
  };
});

function setMockDocState(content: string, selectedText = ""): void {
  docState.content = content;
  docState.selectedText = selectedText;
  act(() => docState.notify());
}

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
  docState.content = "";
  docState.selectedText = "";
});

describe("StatusBarCounts", () => {
  it("renders 0 words and 0 chars for empty content", () => {
    docState.content = "";
    render(<StatusBarCounts />);
    expect(screen.getByText("0 words")).toBeInTheDocument();
    expect(screen.getByText("0 chars")).toBeInTheDocument();
  });

  it("renders word and char counts for plain text", () => {
    docState.content = "hello world";
    render(<StatusBarCounts />);
    expect(screen.getByText("2 words")).toBeInTheDocument();
    expect(screen.getByText("10 chars")).toBeInTheDocument();
  });

  it("strips markdown before counting", () => {
    docState.content = "# Heading\n\n**bold text**";
    render(<StatusBarCounts />);
    // "Heading" + "bold text" = 3 words
    expect(screen.getByText("3 words")).toBeInTheDocument();
  });

  it("renders correct char count excluding whitespace", () => {
    docState.content = "a b c";
    render(<StatusBarCounts />);
    // 3 non-whitespace chars
    expect(screen.getByText("3 chars")).toBeInTheDocument();
  });

  it("renders spans with status-item class", () => {
    docState.content = "test";
    render(<StatusBarCounts />);
    const wordSpan = screen.getByText(/words/);
    const charSpan = screen.getByText(/chars/);
    expect(wordSpan.className).toBe("status-item");
    expect(charSpan.className).toBe("status-item");
  });

  it("updates counts when content changes in a mounted component (cache reuse path)", async () => {
    docState.content = "alpha one.\n\nbeta two.";
    render(<StatusBarCounts />);
    expect(screen.getByText("4 words")).toBeInTheDocument();

    // findByText lets the useDeferredValue re-render land after each change.
    setMockDocState("alpha one.\n\nbeta two edited with more words.");
    expect(await screen.findByText("8 words")).toBeInTheDocument();

    setMockDocState("gamma.");
    expect(await screen.findByText("1 words")).toBeInTheDocument();
  });

  it("select-all never displays selected counts exceeding totals", async () => {
    // "A \n\n B" is the documented charsWithSpaces divergence case. If totals
    // and selection ran through different pipelines, the popover's
    // chars-with-spaces row could render an impossible "8 / 4" pair.
    // Both must use the same semantics.
    docState.content = "A \n\n B";
    docState.selectedText = "A \n\n B";
    const user = userEvent.setup();
    render(<StatusBarCounts />);
    expect(screen.getByText("2 / 2 chars")).toBeInTheDocument();
    expect(screen.getByText("2 / 2 words")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /word count/i }));
    expect(screen.getByTestId("metric-charsWithSpaces")).toHaveTextContent("4 / 4");
  });

  it("handles whitespace-only content", () => {
    docState.content = "   \n\n   ";
    render(<StatusBarCounts />);
    expect(screen.getByText("0 words")).toBeInTheDocument();
    expect(screen.getByText("0 chars")).toBeInTheDocument();
  });

  it("handles single word content", () => {
    docState.content = "hello";
    render(<StatusBarCounts />);
    expect(screen.getByText("1 words")).toBeInTheDocument();
    expect(screen.getByText("5 chars")).toBeInTheDocument();
  });

  it("strips code blocks before counting", () => {
    docState.content = "before\n```js\nconst x = 1;\n```\nafter";
    render(<StatusBarCounts />);
    // Only "before" and "after" remain
    expect(screen.getByText("2 words")).toBeInTheDocument();
  });

  it("handles markdown links", () => {
    docState.content = "[click here](https://example.com)";
    render(<StatusBarCounts />);
    // "click here" = 2 words
    expect(screen.getByText("2 words")).toBeInTheDocument();
    // "clickhere" = 9 chars
    expect(screen.getByText("9 chars")).toBeInTheDocument();
  });

  describe("with selection", () => {
    it("shows selected/total when selection is non-empty", () => {
      docState.content = "alpha beta gamma delta";
      docState.selectedText = "alpha beta";
      render(<StatusBarCounts />);
      expect(screen.getByText("2 / 4 words")).toBeInTheDocument();
      expect(screen.getByText("9 / 19 chars")).toBeInTheDocument();
    });

    it("falls back to total-only when selection is empty", () => {
      docState.content = "alpha beta gamma";
      docState.selectedText = "";
      render(<StatusBarCounts />);
      expect(screen.getByText("3 words")).toBeInTheDocument();
      expect(screen.getByText("14 chars")).toBeInTheDocument();
    });

    it("falls back to total-only when selection is whitespace", () => {
      docState.content = "alpha beta";
      docState.selectedText = "   \n\n  ";
      render(<StatusBarCounts />);
      expect(screen.getByText("2 words")).toBeInTheDocument();
    });

    it("treats selection as present even when only markdown syntax is selected", () => {
      // Selecting just the bold markers around no text — stripped is empty,
      // but the user clearly intended to select something.
      docState.content = "alpha **bold** gamma";
      docState.selectedText = "**";
      render(<StatusBarCounts />);
      // Should still show selection mode (0 selected, total)
      expect(screen.getByText("0 / 3 words")).toBeInTheDocument();
    });

    it("strips markdown from selected text before counting", () => {
      docState.content = "intro **bold word** outro";
      docState.selectedText = "**bold word**";
      render(<StatusBarCounts />);
      // selection: "bold word" -> 2 words, 8 non-ws chars;
      // total: "intro bold word outro" -> 4 words, 18 non-ws chars
      expect(screen.getByText("2 / 4 words")).toBeInTheDocument();
      expect(screen.getByText("8 / 18 chars")).toBeInTheDocument();
    });
  });

  describe("word count popover trigger", () => {
    it("renders the counts inside a button with popover ARIA", () => {
      docState.content = "hello world";
      render(<StatusBarCounts />);
      const trigger = screen.getByRole("button", { name: /word count/i });
      expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });

    it("opens the popover on click and renders metrics", async () => {
      const user = userEvent.setup();
      docState.content = "hello world";
      render(<StatusBarCounts />);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /word count/i }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Words")).toBeInTheDocument();
      expect(screen.getByText(/CJK characters/)).toBeInTheDocument();
    });

    it("toggles aria-expanded when open", async () => {
      const user = userEvent.setup();
      docState.content = "hi";
      render(<StatusBarCounts />);
      const trigger = screen.getByRole("button", { name: /word count/i });
      await user.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
    });

    it("opens via keyboard (Enter)", async () => {
      const user = userEvent.setup();
      docState.content = "hi";
      render(<StatusBarCounts />);
      const trigger = screen.getByRole("button", { name: /word count/i });
      trigger.focus();
      await user.keyboard("{Enter}");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("closes the popover on Escape", async () => {
      const user = userEvent.setup();
      docState.content = "hi";
      render(<StatusBarCounts />);
      await user.click(screen.getByRole("button", { name: /word count/i }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("closes the popover when the trigger is clicked a second time", async () => {
      // Regression: the trigger is inside the dismiss wrapper, so clicking it
      // while open is "inside" — it must not be eaten by outside-click dismiss
      // and then reopened. A second trigger click must close cleanly.
      const user = userEvent.setup();
      docState.content = "hi";
      render(<StatusBarCounts />);
      const trigger = screen.getByRole("button", { name: /word count/i });
      await user.click(trigger);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      await user.click(trigger);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("closes the popover on an outside click", async () => {
      const user = userEvent.setup();
      docState.content = "hi";
      render(<StatusBarCounts />);
      await user.click(screen.getByRole("button", { name: /word count/i }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      await user.click(document.body);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
