import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MarkdownSettings } from "./MarkdownSettings";
import { useSettingsStore } from "@/stores/settingsStore";

/** Find the toggle whose aria-labelledby points to an element with the given text. */
function getToggleByLabel(label: string) {
  const toggles = screen.getAllByRole("switch");
  const match = toggles.find((t) => {
    const labelId = t.getAttribute("aria-labelledby");
    if (!labelId) return false;
    const el = document.getElementById(labelId);
    return el?.textContent === label;
  });
  if (!match) throw new Error(`No toggle found with label "${label}"`);
  return match;
}

describe("MarkdownSettings", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      markdown: {
        ...useSettingsStore.getState().markdown,
        tableFitToWidth: false,
      },
    });
  });

  it("renders the tableFitToWidth toggle", () => {
    render(<MarkdownSettings />);

    expect(screen.getByText("Fit tables to width")).toBeInTheDocument();
    expect(screen.getByText("Constrain all tables to the editor width instead of allowing horizontal scroll")).toBeInTheDocument();
  });

  it("toggle reflects store state (off)", () => {
    render(<MarkdownSettings />);

    const fitToggle = getToggleByLabel("Fit tables to width");
    expect(fitToggle).toHaveAttribute("aria-checked", "false");
  });

  it("toggle reflects store state (on)", () => {
    useSettingsStore.setState({
      markdown: {
        ...useSettingsStore.getState().markdown,
        tableFitToWidth: true,
      },
    });
    render(<MarkdownSettings />);

    const fitToggle = getToggleByLabel("Fit tables to width");
    expect(fitToggle).toHaveAttribute("aria-checked", "true");
  });

  it("clicking toggle updates store", () => {
    render(<MarkdownSettings />);

    const fitToggle = getToggleByLabel("Fit tables to width");
    fireEvent.click(fitToggle);

    expect(useSettingsStore.getState().markdown.tableFitToWidth).toBe(true);
  });

  it("clicking toggle again turns it off", () => {
    useSettingsStore.setState({
      markdown: {
        ...useSettingsStore.getState().markdown,
        tableFitToWidth: true,
      },
    });
    render(<MarkdownSettings />);

    const fitToggle = getToggleByLabel("Fit tables to width");
    fireEvent.click(fitToggle);

    expect(useSettingsStore.getState().markdown.tableFitToWidth).toBe(false);
  });

  describe("pasteMode control (WI-4)", () => {
    beforeEach(() => {
      useSettingsStore.setState({
        markdown: { ...useSettingsStore.getState().markdown, pasteMode: "smart" },
      });
    });

    it("renders the clipboard paste handling control", () => {
      render(<MarkdownSettings />);
      expect(screen.getByText("Clipboard paste handling")).toBeInTheDocument();
    });

    it("reflects the stored pasteMode value", () => {
      render(<MarkdownSettings />);
      expect(
        screen.getByDisplayValue("Smart (convert HTML, detect markdown)")
      ).toBeInTheDocument();
    });

    it("changing the select updates the store", () => {
      render(<MarkdownSettings />);
      const select = screen.getByDisplayValue("Smart (convert HTML, detect markdown)");
      fireEvent.change(select, { target: { value: "plain" } });
      expect(useSettingsStore.getState().markdown.pasteMode).toBe("plain");
    });
  });
});
