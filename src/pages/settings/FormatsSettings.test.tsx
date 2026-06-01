import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FormatsSettings } from "./FormatsSettings";
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
