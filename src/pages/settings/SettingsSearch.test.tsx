import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  SettingsSearchContext,
  matchesSettingsQuery,
} from "./SettingsSearchContext";
import { SettingRow } from "./components";
import { SettingsSearchResults } from "./SettingsSearchResults";

describe("matchesSettingsQuery (WI-7 / D2)", () => {
  it("matches everything when query is empty", () => {
    expect(matchesSettingsQuery("", "Font size", "desc")).toBe(true);
  });
  it("matches on the label", () => {
    expect(matchesSettingsQuery("font", "Font size", "Editor text")).toBe(true);
  });
  it("matches on the description", () => {
    expect(matchesSettingsQuery("editor", "Font size", "Editor text size")).toBe(true);
  });
  it("does not match unrelated rows", () => {
    expect(matchesSettingsQuery("terminal", "Font size", "Editor text size")).toBe(false);
  });
  it("handles a missing description", () => {
    expect(matchesSettingsQuery("theme", "Color theme")).toBe(true);
    expect(matchesSettingsQuery("xyz", "Color theme")).toBe(false);
  });
});

describe("SettingRow search visibility", () => {
  function renderRows(query: string) {
    return render(
      <SettingsSearchContext.Provider value={query}>
        <SettingRow label="Font size" description="Editor text size">
          <span>a</span>
        </SettingRow>
        <SettingRow label="Color theme">
          <span>b</span>
        </SettingRow>
      </SettingsSearchContext.Provider>
    );
  }

  it("marks only matching rows visible when searching", () => {
    renderRows("font");
    const rows = document.querySelectorAll("[data-setting-row]");
    const byLabel = (text: string) =>
      Array.from(rows).find((r) => r.textContent?.includes(text));
    expect(byLabel("Font size")?.getAttribute("data-search-visible")).toBe("true");
    expect(byLabel("Color theme")?.getAttribute("data-search-visible")).toBe("false");
  });

  it("marks all rows visible when query is empty", () => {
    renderRows("");
    const rows = document.querySelectorAll('[data-setting-row][data-search-visible="true"]');
    expect(rows.length).toBe(2);
  });
});

describe("SettingsSearchResults no-results", () => {
  function Panel() {
    return <SettingRow label="Font size" description="Editor text size"><span>a</span></SettingRow>;
  }

  it("shows the no-results message when nothing matches", () => {
    render(
      <SettingsSearchContext.Provider value="zzz">
        <SettingsSearchResults
          panels={[{ id: "editor", label: "Editor", Component: Panel }]}
          query="zzz"
        />
      </SettingsSearchContext.Provider>
    );
    expect(screen.getByText(/No settings match/)).toBeInTheDocument();
  });

  it("renders panels without the no-results message when something matches", () => {
    render(
      <SettingsSearchContext.Provider value="font">
        <SettingsSearchResults
          panels={[{ id: "editor", label: "Editor", Component: Panel }]}
          query="font"
        />
      </SettingsSearchContext.Provider>
    );
    expect(screen.queryByText(/No settings match/)).not.toBeInTheDocument();
    expect(screen.getByText("Editor")).toBeInTheDocument();
  });
});
