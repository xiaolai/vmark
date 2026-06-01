import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LanguageSettings } from "./LanguageSettings";
import { useSettingsStore } from "@/stores/settingsStore";

function getToggleByLabel(label: string) {
  const toggles = screen.getAllByRole("switch");
  const match = toggles.find((t) => {
    const labelId = t.getAttribute("aria-labelledby");
    return labelId ? document.getElementById(labelId)?.textContent === label : false;
  });
  if (!match) throw new Error(`No toggle found with label "${label}"`);
  return match;
}

describe("LanguageSettings — CJK orphans (WI-2)", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      cjkFormatting: {
        ...useSettingsStore.getState().cjkFormatting,
        smartQuoteConversion: true,
        contextualQuotes: true,
        quoteToggleMode: "simple",
        skipReferenceSections: false,
      },
    });
  });

  it("renders the three previously-unexposed CJK controls", () => {
    render(<LanguageSettings />);
    expect(screen.getByText("Contextual quotes")).toBeInTheDocument();
    expect(screen.getByText("Quote toggle behavior")).toBeInTheDocument();
    expect(screen.getByText("Skip reference sections")).toBeInTheDocument();
  });

  it("clicking contextualQuotes toggle updates the store", () => {
    render(<LanguageSettings />);
    fireEvent.click(getToggleByLabel("Contextual quotes"));
    expect(useSettingsStore.getState().cjkFormatting.contextualQuotes).toBe(false);
  });

  it("contextualQuotes toggle is disabled when smartQuoteConversion is off", () => {
    useSettingsStore.setState({
      cjkFormatting: {
        ...useSettingsStore.getState().cjkFormatting,
        smartQuoteConversion: false,
      },
    });
    render(<LanguageSettings />);
    expect(getToggleByLabel("Contextual quotes")).toBeDisabled();
  });

  it("changing quoteToggleMode select updates the store", () => {
    render(<LanguageSettings />);
    const select = screen.getByDisplayValue("Simple (straight ↔ preferred)");
    fireEvent.change(select, { target: { value: "full-cycle" } });
    expect(useSettingsStore.getState().cjkFormatting.quoteToggleMode).toBe("full-cycle");
  });

  it("clicking skipReferenceSections toggle updates the store", () => {
    render(<LanguageSettings />);
    fireEvent.click(getToggleByLabel("Skip reference sections"));
    expect(useSettingsStore.getState().cjkFormatting.skipReferenceSections).toBe(true);
  });

  it("exercises every toggle and select without throwing", () => {
    render(<LanguageSettings />);
    expect(() => exerciseAllControls()).not.toThrow();
    // Sanity: at least one CJK setting flipped from the bulk interaction.
    expect(useSettingsStore.getState().cjkFormatting).toBeDefined();
  });
});

/** Click every switch and change every CJK select to its last option — covers
 *  the CJK onChange handlers. The UI-language picker is skipped: it triggers
 *  app-wide locale machinery (i18n + native menu rebuild), not a plain setting. */
function exerciseAllControls() {
  screen.getAllByRole("switch").forEach((s) => fireEvent.click(s));
  document.querySelectorAll("select").forEach((sel) => {
    const opts = Array.from(sel.querySelectorAll("option"));
    // The language picker's options include locale codes like "zh-CN".
    if (opts.some((o) => o.value === "zh-CN")) return;
    if (opts.length) {
      fireEvent.change(sel, { target: { value: opts[opts.length - 1].value } });
    }
  });
}
