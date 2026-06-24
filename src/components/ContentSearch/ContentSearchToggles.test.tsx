import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useUIStore } from "@/stores/uiStore";
import { ContentSearchToggles } from "./ContentSearchToggles";

function setup(props: Partial<Parameters<typeof ContentSearchToggles>[0]> = {}) {
  return render(
    <ContentSearchToggles
      caseSensitive={false}
      wholeWord={false}
      useRegex={false}
      markdownOnly={false}
      statusText=""
      statusError={false}
      {...props}
    />,
  );
}

describe("ContentSearchToggles", () => {
  let setCase: ReturnType<typeof vi.fn>;
  let setWhole: ReturnType<typeof vi.fn>;
  let setRegex: ReturnType<typeof vi.fn>;
  let setMd: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setCase = vi.fn();
    setWhole = vi.fn();
    setRegex = vi.fn();
    setMd = vi.fn();
    useUIStore.setState({
      contentSearchSetCaseSensitive: setCase as never,
      contentSearchSetWholeWord: setWhole as never,
      contentSearchSetUseRegex: setRegex as never,
      contentSearchSetMarkdownOnly: setMd as never,
    });
  });

  // The four toggles carry an aria-label (the raw i18n key in the test env) and
  // a visible glyph. The accessible name comes from the aria-label, so query
  // by that stable key.
  const caseBtn = () =>
    screen.getByRole("button", { name: "contentSearch.caseSensitive" });
  const wholeBtn = () =>
    screen.getByRole("button", { name: "contentSearch.wholeWord" });
  const regexBtn = () =>
    screen.getByRole("button", { name: "contentSearch.regex" });
  const mdBtn = () =>
    screen.getByRole("button", { name: "contentSearch.markdownOnly" });

  it("reflects active state via aria-pressed", () => {
    setup({ caseSensitive: true, useRegex: true });
    expect(caseBtn()).toHaveAttribute("aria-pressed", "true");
    expect(regexBtn()).toHaveAttribute("aria-pressed", "true");
    expect(wholeBtn()).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles case sensitivity on click (flips the current value)", async () => {
    const user = userEvent.setup();
    setup({ caseSensitive: false });
    await user.click(caseBtn());
    expect(setCase).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("toggles whole word on click", async () => {
    const user = userEvent.setup();
    setup({ wholeWord: true });
    await user.click(wholeBtn());
    expect(setWhole).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("toggles regex on click", async () => {
    const user = userEvent.setup();
    setup({ useRegex: false });
    await user.click(regexBtn());
    expect(setRegex).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("toggles markdown-only on click", async () => {
    const user = userEvent.setup();
    setup({ markdownOnly: false });
    await user.click(mdBtn());
    expect(setMd).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("shows the status text when provided", () => {
    setup({ statusText: "42 matches" });
    expect(screen.getByText("42 matches")).toBeInTheDocument();
  });

  it("omits the status element when status text is empty", () => {
    setup({ statusText: "" });
    expect(screen.queryByText(/matches/)).not.toBeInTheDocument();
  });
});
