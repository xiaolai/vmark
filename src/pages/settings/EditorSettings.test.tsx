// WI-FL5.7 — the Editor pane's dependent rows. The auto-pair family reveals
// itself progressively: "CJK brackets" is disabled until "Enable auto-pairing"
// is on; "Include curly quotes" exists only while CJK pairing is "auto"; "Also
// pair ”" exists only while curly quotes are also on. Each dependent control
// reflects the store and writes its OWN key, so switching a parent changes
// whether a child can be reached — never the child's stored value.
//
// Real settings store, reset per test. RTL queries by accessible role/name:
// `SettingRow` wires `aria-labelledby` to the row label, so a switch or
// combobox is found by the label text a user reads.
//
// Feature ledger, Area 13 "Editor pane — behavior, whitespace, large files"
// (id editor-settings-pane).

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorSettings } from "./EditorSettings";
import { useSettingsStore } from "@/stores/settingsStore";

type Markdown = ReturnType<typeof useSettingsStore.getState>["markdown"];

const store = () => useSettingsStore.getState();

function setMarkdown(patch: Partial<Markdown>): void {
  useSettingsStore.setState({ markdown: { ...store().markdown, ...patch } });
}

const AUTO_PAIR = /^enable auto-pairing$/i;
const CJK = /^cjk brackets$/i;
const CURLY = /^include curly quotes$/i;
const RIGHT_QUOTE = /^also pair/i;

const cjkSelect = () => screen.getByRole("combobox", { name: CJK });
const curlySwitch = () => screen.queryByRole("switch", { name: CURLY });
const rightQuoteSwitch = () => screen.queryByRole("switch", { name: RIGHT_QUOTE });

beforeEach(() => {
  store().resetSettings();
});

describe("EditorSettings — the auto-pair family reveals itself progressively", () => {
  it("disables the CJK, curly-quote and right-quote controls while auto-pairing is off", () => {
    setMarkdown({ autoPairEnabled: false });
    render(<EditorSettings />);

    // Defaults keep CJK "auto" and curly quotes on, so all three dependent
    // rows are RENDERED — the parent being off greys them out, it does not
    // remove them (a user must still see what turning it on would enable).
    expect(cjkSelect()).toBeDisabled();
    expect(curlySwitch()).toBeDisabled();
    expect(rightQuoteSwitch()).toBeDisabled();
  });

  it("turning the parent on enables the dependent controls", async () => {
    const user = userEvent.setup();
    setMarkdown({ autoPairEnabled: false });
    render(<EditorSettings />);

    await user.click(screen.getByRole("switch", { name: AUTO_PAIR }));

    expect(store().markdown.autoPairEnabled).toBe(true);
    expect(cjkSelect()).toBeEnabled();
    expect(curlySwitch()).toBeEnabled();
    expect(rightQuoteSwitch()).toBeEnabled();
  });

  it("turning the parent on leaves the children's stored values untouched", async () => {
    const user = userEvent.setup();
    setMarkdown({
      autoPairEnabled: false,
      autoPairCJKStyle: "off",
      autoPairCurlyQuotes: false,
      autoPairRightDoubleQuote: true,
    });
    render(<EditorSettings />);

    await user.click(screen.getByRole("switch", { name: AUTO_PAIR }));

    expect(store().markdown).toMatchObject({
      autoPairEnabled: true,
      autoPairCJKStyle: "off",
      autoPairCurlyQuotes: false,
      autoPairRightDoubleQuote: true,
    });
    expect(cjkSelect()).toHaveValue("off");
  });

  it("shows the curly-quote row only while CJK pairing is 'auto', and the select writes autoPairCJKStyle", async () => {
    const user = userEvent.setup();
    setMarkdown({ autoPairCJKStyle: "off" });
    render(<EditorSettings />);

    expect(cjkSelect()).toHaveValue("off");
    expect(curlySwitch()).toBeNull();
    expect(rightQuoteSwitch()).toBeNull();

    await user.selectOptions(cjkSelect(), "auto");

    expect(store().markdown.autoPairCJKStyle).toBe("auto");
    // Revealed, and reflecting the stored default (curly quotes ship ON) —
    // not a fresh control that starts from off.
    expect(curlySwitch()).toBeChecked();
    expect(rightQuoteSwitch()).not.toBeNull();
  });

  it("shows the right-quote row only while curly quotes are on; it writes its own key and keeps it when hidden", async () => {
    const user = userEvent.setup();
    setMarkdown({ autoPairCurlyQuotes: false });
    render(<EditorSettings />);

    expect(curlySwitch()).not.toBeChecked();
    expect(rightQuoteSwitch()).toBeNull();

    await user.click(curlySwitch()!);
    expect(store().markdown.autoPairCurlyQuotes).toBe(true);
    expect(rightQuoteSwitch()).not.toBeChecked();

    await user.click(rightQuoteSwitch()!);
    expect(store().markdown.autoPairRightDoubleQuote).toBe(true);
    expect(rightQuoteSwitch()).toBeChecked();

    // Hiding the row is not resetting it: the value persists, and
    // `services/assembly/autoPairConfig.ts` is what makes it inert meanwhile.
    await user.click(curlySwitch()!);
    expect(store().markdown.autoPairCurlyQuotes).toBe(false);
    expect(rightQuoteSwitch()).toBeNull();
    expect(store().markdown.autoPairRightDoubleQuote).toBe(true);
  });

  it("reflects a store change made elsewhere (another window, a reset)", () => {
    render(<EditorSettings />);
    expect(cjkSelect()).toBeEnabled();
    expect(curlySwitch()).not.toBeNull();

    act(() => setMarkdown({ autoPairEnabled: false, autoPairCJKStyle: "off" }));

    expect(cjkSelect()).toBeDisabled();
    expect(cjkSelect()).toHaveValue("off");
    expect(curlySwitch()).toBeNull();
  });
});

describe("EditorSettings — behavior rows write the store with the declared type", () => {
  it("Tab size stores a NUMBER, although a <select> can only hand back a string", async () => {
    const user = userEvent.setup();
    render(<EditorSettings />);
    const tabSize = screen.getByRole("combobox", { name: /^tab size$/i });
    expect(tabSize).toHaveValue("2");

    await user.selectOptions(tabSize, "4");

    expect(store().general.tabSize).toBe(4);
    expect(tabSize).toHaveValue("4");
  });

  it("Open files in a new tab toggles general.openInNewTab", async () => {
    const user = userEvent.setup();
    render(<EditorSettings />);
    const toggle = screen.getByRole("switch", { name: /^open files in a new tab$/i });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);
    expect(store().general.openInNewTab).toBe(true);
    await user.click(toggle);
    expect(store().general.openInNewTab).toBe(false);
  });

  it("Copy format and Copy on select write their markdown keys", async () => {
    const user = userEvent.setup();
    render(<EditorSettings />);

    await user.selectOptions(screen.getByRole("combobox", { name: /^copy format$/i }), "markdown");
    expect(store().markdown.copyFormat).toBe("markdown");

    await user.click(screen.getByRole("switch", { name: /^copy on select$/i }));
    expect(store().markdown.copyOnSelect).toBe(true);
  });
});

describe("EditorSettings — typography selects", () => {
  it("stores numeric options as numbers and font families as strings", async () => {
    const user = userEvent.setup();
    render(<EditorSettings />);

    await user.selectOptions(screen.getByRole("combobox", { name: /^font size$/i }), "20");
    expect(store().appearance.fontSize).toBe(20);

    await user.selectOptions(screen.getByRole("combobox", { name: /^latin font$/i }), "georgia");
    expect(store().appearance.latinFont).toBe("georgia");
  });
});

describe("EditorSettings — large files", () => {
  it("the two toggles write largeFile.autoSourceMode and largeFile.warnAbove5MB independently", async () => {
    const user = userEvent.setup();
    render(<EditorSettings />);
    const autoSource = screen.getByRole("switch", { name: /^open files over 1 mb in source mode$/i });
    const warn = screen.getByRole("switch", { name: /^warn before opening files over 5 mb$/i });
    expect(autoSource).toBeChecked();
    expect(warn).toBeChecked();

    await user.click(autoSource);
    expect(store().largeFile).toEqual({ autoSourceMode: false, warnAbove5MB: true });

    await user.click(warn);
    expect(store().largeFile).toEqual({ autoSourceMode: false, warnAbove5MB: false });
  });
});

describe("EditorSettings — composition", () => {
  it("mounts the Whitespace group, so its controls are reachable from the Editor pane", () => {
    render(<EditorSettings />);
    expect(screen.getByRole("combobox", { name: /^line endings on save$/i })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /^show invisibles$/i })).toBeInTheDocument();
  });
});
