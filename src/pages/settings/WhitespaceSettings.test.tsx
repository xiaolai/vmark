// WI-FL5.7 — the Whitespace group: six controls, six keys, two store sections.
// Each control reflects its stored value and writes ONLY its own key. The group
// mixes `general.lineEndingsOnSave` with five `markdown.*` keys, so a mis-wired
// row would look right on screen and only show up when a save rewrote the
// wrong thing.
//
// Real settings store, reset per test; RTL queries by accessible role/name.
// Feature ledger, Area 13 "Editor pane — behavior, whitespace, large files";
// Area 3 "whitespace-and-line-endings".

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WhitespaceSettings } from "./WhitespaceSettings";
import { useSettingsStore } from "@/stores/settingsStore";

type Markdown = ReturnType<typeof useSettingsStore.getState>["markdown"];
type General = ReturnType<typeof useSettingsStore.getState>["general"];
type BoolKey = "preserveLineBreaks" | "preserveBlankLines" | "showBrTags" | "showInvisibles";

const store = () => useSettingsStore.getState();

const LINE_ENDINGS = /^line endings on save$/i;
const HARD_BREAK = /^hard break style on save$/i;
const TOGGLES: ReadonlyArray<[RegExp, BoolKey]> = [
  [/^line breaks become hard breaks$/i, "preserveLineBreaks"],
  [/^preserve blank lines$/i, "preserveBlankLines"],
  [/^show <br> tags$/i, "showBrTags"],
  [/^show invisibles$/i, "showInvisibles"],
];

beforeEach(() => {
  store().resetSettings();
});

describe("WhitespaceSettings — reflects the store", () => {
  it("renders the shipped defaults", () => {
    render(<WhitespaceSettings />);

    expect(screen.getByRole("combobox", { name: LINE_ENDINGS })).toHaveValue("preserve");
    expect(screen.getByRole("combobox", { name: HARD_BREAK })).toHaveValue("preserve");
    expect(screen.getByRole("switch", { name: TOGGLES[0][0] })).not.toBeChecked();
    // Blank-line preservation ships ON: a plain save must not collapse blank
    // lines the file already had.
    expect(screen.getByRole("switch", { name: TOGGLES[1][0] })).toBeChecked();
    expect(screen.getByRole("switch", { name: TOGGLES[2][0] })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: TOGGLES[3][0] })).not.toBeChecked();
  });

  it("follows a change made outside the pane", () => {
    render(<WhitespaceSettings />);

    act(() => {
      useSettingsStore.setState({
        general: { ...store().general, lineEndingsOnSave: "crlf" },
        markdown: { ...store().markdown, showInvisibles: true, hardBreakStyleOnSave: "backslash" },
      });
    });

    expect(screen.getByRole("combobox", { name: LINE_ENDINGS })).toHaveValue("crlf");
    expect(screen.getByRole("combobox", { name: HARD_BREAK })).toHaveValue("backslash");
    expect(screen.getByRole("switch", { name: TOGGLES[3][0] })).toBeChecked();
  });
});

describe("WhitespaceSettings — writes exactly one key per control", () => {
  it.each<General["lineEndingsOnSave"]>(["lf", "crlf", "preserve"])(
    "Line endings on save = %s writes general.lineEndingsOnSave and nothing in markdown",
    async (value) => {
      const user = userEvent.setup();
      useSettingsStore.setState({
        general: { ...store().general, lineEndingsOnSave: value === "preserve" ? "lf" : "preserve" },
      });
      const markdownBefore = store().markdown;
      render(<WhitespaceSettings />);

      await user.selectOptions(screen.getByRole("combobox", { name: LINE_ENDINGS }), value);

      expect(store().general.lineEndingsOnSave).toBe(value);
      expect(store().markdown).toEqual(markdownBefore);
    },
  );

  it.each<Markdown["hardBreakStyleOnSave"]>(["twoSpaces", "backslash", "preserve"])(
    "Hard break style on save = %s writes markdown.hardBreakStyleOnSave and nothing in general",
    async (value) => {
      const user = userEvent.setup();
      useSettingsStore.setState({
        markdown: { ...store().markdown, hardBreakStyleOnSave: value === "preserve" ? "twoSpaces" : "preserve" },
      });
      const generalBefore = store().general;
      render(<WhitespaceSettings />);

      await user.selectOptions(screen.getByRole("combobox", { name: HARD_BREAK }), value);

      expect(store().markdown.hardBreakStyleOnSave).toBe(value);
      expect(store().general).toEqual(generalBefore);
    },
  );

  it.each(TOGGLES)("%s flips only its own key", async (name, key) => {
    const user = userEvent.setup();
    render(<WhitespaceSettings />);
    const before = store().markdown;

    await user.click(screen.getByRole("switch", { name }));

    const after = store().markdown;
    expect(after[key]).toBe(!before[key]);
    expect({ ...after, [key]: before[key] }).toEqual(before);
    expect(screen.getByRole("switch", { name })).toHaveAttribute("aria-checked", String(!before[key]));
  });
});
