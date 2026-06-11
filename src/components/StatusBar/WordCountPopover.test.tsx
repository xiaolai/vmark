import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// alfaaz is a native-ish module; stub with a whitespace splitter that also
// treats each CJK char as its own word (matches the real library closely
// enough for these UI tests).
vi.mock("alfaaz", () => ({
  countWords: (text: string) => {
    const cjk = (text.match(/[一-鿿]/g) ?? []).length;
    const latin = text.replace(/[一-鿿]/g, " ").trim();
    const latinWords = latin ? latin.split(/\s+/).length : 0;
    return cjk + latinWords;
  },
}));

import { WordCountPopover } from "./WordCountPopover";

function renderPopover(props: Partial<React.ComponentProps<typeof WordCountPopover>> = {}) {
  const onClose = props.onClose ?? vi.fn();
  render(
    <WordCountPopover
      anchorRef={{ current: document.createElement("div") }}
      content={props.content ?? "hello world"}
      selectedText={props.selectedText ?? ""}
      hasSelection={props.hasSelection ?? false}
      onClose={onClose}
    />,
  );
  return { onClose };
}

describe("WordCountPopover", () => {
  it("renders a dialog with all metric rows", () => {
    renderPopover({ content: "hello world" });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // Labels (from statusbar locale)
    expect(screen.getByText("Words")).toBeInTheDocument();
    expect(screen.getByText("Characters")).toBeInTheDocument();
    expect(screen.getByText("Characters (no spaces)")).toBeInTheDocument();
    expect(screen.getByText(/CJK characters/)).toBeInTheDocument();
    expect(screen.getByText("Characters (no punctuation)")).toBeInTheDocument();
  });

  it("shows total-only values when there is no selection", () => {
    renderPopover({ content: "hello world", hasSelection: false });
    // 2 words, 11 chars with spaces, 10 without
    expect(screen.getByTestId("metric-words")).toHaveTextContent("2");
    expect(screen.getByTestId("metric-charsWithSpaces")).toHaveTextContent("11");
    expect(screen.getByTestId("metric-charsNoSpaces")).toHaveTextContent("10");
  });

  it("shows selected / total per row when a selection exists", () => {
    renderPopover({
      content: "alpha beta gamma",
      selectedText: "alpha beta",
      hasSelection: true,
    });
    // selected words 2 / total 3
    expect(screen.getByTestId("metric-words")).toHaveTextContent("2 / 3");
  });

  it("counts CJK characters (字数) for Chinese content", () => {
    renderPopover({ content: "你好世界" });
    expect(screen.getByTestId("metric-cjkChars")).toHaveTextContent("4");
  });

  it("dismisses on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPopover();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("dismisses on outside click", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPopover();
    await user.click(document.body);
    expect(onClose).toHaveBeenCalled();
  });
});
