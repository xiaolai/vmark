// @vitest-environment node
// WI-FL5.7 — the auto-pair config derived from settings. `currentAutoPairConfig`
// is the `getConfig` the host injects into plugins/autoPair (ADR-015: the plugin
// declares the shape it needs, the host fills it from the store). What this
// pins is the DERIVED flag: `normalizeRightDoubleQuote` is true only when CJK
// pairing AND curly quotes are both on — the setting behind it is otherwise
// ignored — plus the master switch, the CJK style, and the legacy-blob
// fallbacks, which must match the shipped defaults.
//
// Real settings store, reset per test. Feature ledger, Area 1 "auto-pair" and
// Area 13 "CJK auto-pair brackets and quotes" (id cjk-auto-pair).

import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { currentAutoPairConfig } from "./autoPairConfig";

type Markdown = ReturnType<typeof useSettingsStore.getState>["markdown"];

function setMarkdown(patch: Partial<Markdown>): void {
  useSettingsStore.setState({
    markdown: { ...useSettingsStore.getState().markdown, ...patch },
  });
}

beforeEach(() => {
  useSettingsStore.getState().resetSettings();
});

describe("currentAutoPairConfig", () => {
  it("maps the shipped defaults: everything pairs, right-quote normalisation off", () => {
    expect(currentAutoPairConfig()).toEqual({
      enabled: true,
      includeCJK: true,
      includeCurlyQuotes: true,
      normalizeRightDoubleQuote: false,
    });
  });

  it("autoPairEnabled off switches the plugin off (the CJK/quote flags ride behind it)", () => {
    setMarkdown({ autoPairEnabled: false });
    // `enabled` is the master switch the plugin checks FIRST (handlers.ts
    // returns before any pair lookup), so the CJK and quote flags are not
    // consulted while it is false — the config leaves them as derived.
    expect(currentAutoPairConfig().enabled).toBe(false);
    setMarkdown({ autoPairEnabled: true });
    expect(currentAutoPairConfig().enabled).toBe(true);
  });

  it("autoPairCJKStyle decides the CJK pairs: 'off' drops them, 'auto' keeps them", () => {
    setMarkdown({ autoPairCJKStyle: "off" });
    expect(currentAutoPairConfig().includeCJK).toBe(false);
    setMarkdown({ autoPairCJKStyle: "auto" });
    expect(currentAutoPairConfig().includeCJK).toBe(true);
  });

  it("autoPairCurlyQuotes maps straight onto includeCurlyQuotes", () => {
    setMarkdown({ autoPairCurlyQuotes: false });
    expect(currentAutoPairConfig().includeCurlyQuotes).toBe(false);
    setMarkdown({ autoPairCurlyQuotes: true });
    expect(currentAutoPairConfig().includeCurlyQuotes).toBe(true);
  });

  describe("normalizeRightDoubleQuote is DERIVED — CJK on AND curly quotes on AND the setting on", () => {
    it("is true only when all three are on", () => {
      setMarkdown({
        autoPairCJKStyle: "auto",
        autoPairCurlyQuotes: true,
        autoPairRightDoubleQuote: true,
      });
      expect(currentAutoPairConfig().normalizeRightDoubleQuote).toBe(true);
    });

    it.each<[Markdown["autoPairCJKStyle"], boolean, boolean]>([
      ["off", false, false],
      ["off", false, true],
      ["off", true, false],
      ["off", true, true],
      ["auto", false, false],
      ["auto", false, true],
      ["auto", true, false],
    ])(
      "is false for cjk=%s curly=%s rightQuote=%s",
      (autoPairCJKStyle, autoPairCurlyQuotes, autoPairRightDoubleQuote) => {
        setMarkdown({ autoPairCJKStyle, autoPairCurlyQuotes, autoPairRightDoubleQuote });
        expect(currentAutoPairConfig().normalizeRightDoubleQuote).toBe(false);
      },
    );

    it("ignores the right-quote setting while CJK pairing is off, even with curly quotes on", () => {
      // The Editor pane hides the "Also pair ”" row in this state; the stored
      // value survives hidden, and THIS is what keeps it inert.
      setMarkdown({
        autoPairCJKStyle: "off",
        autoPairCurlyQuotes: true,
        autoPairRightDoubleQuote: true,
      });
      expect(currentAutoPairConfig()).toMatchObject({
        includeCJK: false,
        includeCurlyQuotes: true,
        normalizeRightDoubleQuote: false,
      });
    });
  });

  it("reads the store on every call, so a change reaches the next keystroke without rebuilding the editor", () => {
    expect(currentAutoPairConfig().enabled).toBe(true);
    setMarkdown({ autoPairEnabled: false });
    expect(currentAutoPairConfig().enabled).toBe(false);
    setMarkdown({ autoPairCJKStyle: "off" });
    expect(currentAutoPairConfig().includeCJK).toBe(false);
  });

  it("falls back to the shipped defaults for a blob persisted before a key existed", () => {
    // A settings blob from before these keys existed reads `undefined` for
    // them. The fallbacks must equal defaults.ts, or an upgrade would silently
    // change pairing behaviour.
    setMarkdown({
      autoPairEnabled: undefined as unknown as boolean,
      autoPairCurlyQuotes: undefined as unknown as boolean,
      autoPairRightDoubleQuote: undefined as unknown as boolean,
    });
    expect(currentAutoPairConfig()).toEqual({
      enabled: true,
      includeCJK: true,
      includeCurlyQuotes: true,
      normalizeRightDoubleQuote: false,
    });
  });
});
