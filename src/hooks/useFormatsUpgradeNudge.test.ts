import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

const labelRef = { current: "main" };
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: labelRef.current }),
}));

const toastInfoMock = vi.fn();
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { info: (...args: unknown[]) => toastInfoMock(...args) },
}));

const openSettingsMock = vi.fn(async () => {});
vi.mock("@/services/navigation/settingsWindow", () => ({
  openSettingsWindow: (...args: unknown[]) => openSettingsMock(...args),
}));

import { useSettingsStore } from "@/stores/settingsStore";
import { useFormatsUpgradeNudge } from "./useFormatsUpgradeNudge";

function seedFormats(overrides: Partial<{
  dataFormats: boolean;
  diagrams: boolean;
  htmlPreview: boolean;
  codeViewers: boolean;
  upgradeNudgeShown: boolean;
}> = {}) {
  useSettingsStore.setState((s) => ({
    formats: {
      ...s.formats,
      dataFormats: false,
      diagrams: false,
      htmlPreview: false,
      codeViewers: false,
      upgradeNudgeShown: false,
      ...overrides,
    },
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  labelRef.current = "main";
  toastInfoMock.mockClear();
  openSettingsMock.mockClear();
  seedFormats();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useFormatsUpgradeNudge", () => {
  it("does nothing on a non-main window", () => {
    labelRef.current = "settings";
    seedFormats({ upgradeNudgeShown: false });

    renderHook(() => useFormatsUpgradeNudge());
    vi.advanceTimersByTime(5000);

    expect(toastInfoMock).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().formats.upgradeNudgeShown).toBe(false);
  });

  it("does nothing when the nudge has already been shown", () => {
    seedFormats({ upgradeNudgeShown: true });

    renderHook(() => useFormatsUpgradeNudge());
    vi.advanceTimersByTime(5000);

    expect(toastInfoMock).not.toHaveBeenCalled();
  });

  it("auto-marks shown without firing the toast when any format category is already enabled", () => {
    seedFormats({ dataFormats: true });

    renderHook(() => useFormatsUpgradeNudge());
    vi.advanceTimersByTime(5000);

    expect(useSettingsStore.getState().formats.upgradeNudgeShown).toBe(true);
    expect(toastInfoMock).not.toHaveBeenCalled();
  });

  it("persists upgradeNudgeShown immediately on schedule, then fires the toast after the delay", () => {
    seedFormats();

    renderHook(() => useFormatsUpgradeNudge());

    // The flag is flipped synchronously when the timer is scheduled —
    // BEFORE the toast actually fires — to win the cold-start / HMR race.
    expect(useSettingsStore.getState().formats.upgradeNudgeShown).toBe(true);
    expect(toastInfoMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1500);
    expect(toastInfoMock).toHaveBeenCalledTimes(1);
  });

  it("clears the pending toast on unmount before it fires", () => {
    seedFormats();

    const { unmount } = renderHook(() => useFormatsUpgradeNudge());
    unmount();
    vi.advanceTimersByTime(5000);

    expect(toastInfoMock).not.toHaveBeenCalled();
  });
});
