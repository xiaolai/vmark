import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WordCountPopover } from "./WordCountPopover";
import type { TextMetrics } from "./statusTextMetrics";

function metrics(overrides: Partial<TextMetrics> = {}): TextMetrics {
  return {
    words: 0,
    charsWithSpaces: 0,
    charsNoSpaces: 0,
    cjkChars: 0,
    charsNoPunctuation: 0,
    ...overrides,
  };
}

function renderPopover(
  props: Partial<React.ComponentProps<typeof WordCountPopover>> = {},
) {
  render(
    <WordCountPopover
      anchorRef={{ current: document.createElement("div") }}
      totals={props.totals ?? metrics()}
      selected={props.selected ?? metrics()}
      hasSelection={props.hasSelection ?? false}
    />,
  );
}

describe("WordCountPopover", () => {
  it("renders a dialog with all metric rows", () => {
    renderPopover();
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
    renderPopover({
      totals: metrics({ words: 2, charsWithSpaces: 11, charsNoSpaces: 10 }),
      hasSelection: false,
    });
    expect(screen.getByTestId("metric-words")).toHaveTextContent("2");
    expect(screen.getByTestId("metric-charsWithSpaces")).toHaveTextContent("11");
    expect(screen.getByTestId("metric-charsNoSpaces")).toHaveTextContent("10");
  });

  it("shows selected / total per row when a selection exists", () => {
    renderPopover({
      totals: metrics({ words: 3 }),
      selected: metrics({ words: 2 }),
      hasSelection: true,
    });
    expect(screen.getByTestId("metric-words")).toHaveTextContent("2 / 3");
  });

  it("renders the CJK character count (字数) it is given", () => {
    renderPopover({ totals: metrics({ cjkChars: 4 }) });
    expect(screen.getByTestId("metric-cjkChars")).toHaveTextContent("4");
  });
});
