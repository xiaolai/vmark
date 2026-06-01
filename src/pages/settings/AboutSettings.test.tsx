import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AboutSettings } from "./AboutSettings";
import { useSettingsStore } from "@/stores/settingsStore";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("1.2.3"),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));
vi.mock("@/hooks/useUpdateOperations", () => ({
  useUpdateOperations: () => ({
    checkForUpdates: vi.fn(),
    downloadAndInstall: vi.fn(),
    restartApp: vi.fn(),
    skipVersion: vi.fn(),
  }),
}));

function getToggleByLabel(label: string) {
  const toggles = screen.getAllByRole("switch");
  const match = toggles.find((t) => {
    const labelId = t.getAttribute("aria-labelledby");
    return labelId ? document.getElementById(labelId)?.textContent === label : false;
  });
  if (!match) throw new Error(`No toggle found with label "${label}"`);
  return match;
}

describe("AboutSettings — update controls (WI-3)", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      update: {
        ...useSettingsStore.getState().update,
        autoCheckEnabled: true,
        checkFrequency: "startup",
        autoDownload: false,
      },
    });
  });

  it("renders the check frequency and auto-download controls", () => {
    render(<AboutSettings />);
    expect(screen.getByText("Check frequency")).toBeInTheDocument();
    expect(screen.getByText("Download updates automatically")).toBeInTheDocument();
  });

  it("changing check frequency updates the store", () => {
    render(<AboutSettings />);
    const select = screen.getByDisplayValue("On startup");
    fireEvent.change(select, { target: { value: "weekly" } });
    expect(useSettingsStore.getState().update.checkFrequency).toBe("weekly");
  });

  it("toggling auto-download updates the store", () => {
    render(<AboutSettings />);
    fireEvent.click(getToggleByLabel("Download updates automatically"));
    expect(useSettingsStore.getState().update.autoDownload).toBe(true);
  });

  it("check frequency is disabled when automatic updates are off", () => {
    useSettingsStore.setState({
      update: { ...useSettingsStore.getState().update, autoCheckEnabled: false },
    });
    render(<AboutSettings />);
    expect(screen.getByDisplayValue("On startup")).toBeDisabled();
  });
});
