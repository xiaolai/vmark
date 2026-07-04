import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FormatsSettings } from "./FormatsSettings";
import { SettingsSearchContext } from "./SettingsSearchContext";
import { useSettingsStore } from "@/stores/settingsStore";

describe("FormatsSettings — file type overrides (WI-5)", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      formats: { ...useSettingsStore.getState().formats, associations: {} },
    });
  });

  it("shows the empty state when there are no overrides", () => {
    render(<FormatsSettings />);
    expect(screen.getByText("File Type Overrides")).toBeInTheDocument();
    expect(screen.getByText("No overrides yet.")).toBeInTheDocument();
  });

  it("lists existing associations by key", () => {
    useSettingsStore.setState({
      formats: {
        ...useSettingsStore.getState().formats,
        associations: { env: "txt", log: "markdown" },
      },
    });
    render(<FormatsSettings />);
    expect(screen.getByText("env")).toBeInTheDocument();
    expect(screen.getByText("log")).toBeInTheDocument();
  });

  it("removing one override updates the store and keeps the rest", () => {
    useSettingsStore.setState({
      formats: {
        ...useSettingsStore.getState().formats,
        associations: { env: "txt", log: "markdown" },
      },
    });
    render(<FormatsSettings />);
    fireEvent.click(screen.getByLabelText("Remove override for env"));
    const assoc = useSettingsStore.getState().formats.associations;
    expect(assoc).toEqual({ log: "markdown" });
  });

  it("clear all empties the associations map", () => {
    useSettingsStore.setState({
      formats: {
        ...useSettingsStore.getState().formats,
        associations: { env: "txt", log: "markdown" },
      },
    });
    render(<FormatsSettings />);
    fireEvent.click(screen.getByText("Clear all"));
    expect(useSettingsStore.getState().formats.associations).toEqual({});
  });
});

describe("FormatsSettings — settings search discoverability", () => {
  // Settings search hides any .settings-search-group without a visible
  // [data-setting-row] child (settings-search.css). Sections that are not
  // built from SettingRow must therefore mark themselves as searchable
  // rows, or they can never be found via search.
  function renderWithQuery(query: string) {
    return render(
      <SettingsSearchContext.Provider value={query}>
        <FormatsSettings />
      </SettingsSearchContext.Provider>
    );
  }

  it("file-type overrides section is a searchable row that matches its title", () => {
    renderWithQuery("overrides");
    const row = screen.getByText("No overrides yet.").closest("[data-setting-row]");
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute("data-search-visible", "true");
  });

  it("file-type overrides section hides for a non-matching query", () => {
    renderWithQuery("zzz-no-match");
    const row = screen.getByText("No overrides yet.").closest("[data-setting-row]");
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute("data-search-visible", "false");
  });

  it("external editor section is a searchable row that matches its label", () => {
    renderWithQuery("external editor");
    const row = screen.getByText("Browse…").closest("[data-setting-row]");
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute("data-search-visible", "true");
  });

  it("external editor section hides for a non-matching query", () => {
    renderWithQuery("zzz-no-match");
    const row = screen.getByText("Browse…").closest("[data-setting-row]");
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute("data-search-visible", "false");
  });
});

describe("FormatsSettings — default view mode (WI-2.3)", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      formats: { ...useSettingsStore.getState().formats, defaultViewMode: "split" },
    });
  });

  it("reflects the current default and writes changes back to the store", () => {
    render(<FormatsSettings />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("split");

    fireEvent.change(select, { target: { value: "preview" } });
    expect(useSettingsStore.getState().formats.defaultViewMode).toBe("preview");

    fireEvent.change(select, { target: { value: "source" } });
    expect(useSettingsStore.getState().formats.defaultViewMode).toBe("source");
  });
});
