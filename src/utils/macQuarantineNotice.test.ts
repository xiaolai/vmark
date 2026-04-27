import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted mock controls so we can drive each test path.
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isMac: vi.fn(() => true),
  toastInfo: vi.fn(),
  settingsState: { advanced: { clearMacQuarantineOnOpen: true } } as {
    advanced: { clearMacQuarantineOnOpen: boolean };
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@/utils/shortcutMatch", () => ({
  isMacPlatform: mocks.isMac,
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => mocks.settingsState,
  },
}));

vi.mock("@/utils/imeToast", () => ({
  imeToast: { info: mocks.toastInfo },
}));

vi.mock("@/i18n", () => ({
  default: { t: (key: string) => key },
}));

vi.mock("@/utils/debug", () => ({
  workspaceError: vi.fn(),
}));

import { maybeStripMacQuarantine } from "./macQuarantineNotice";

const NOTICE_FLAG_KEY = "vmark-mac-quarantine-notice-shown";

describe("maybeStripMacQuarantine", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.isMac.mockReturnValue(true);
    mocks.toastInfo.mockReset();
    mocks.settingsState.advanced.clearMacQuarantineOnOpen = true;
    globalThis.localStorage?.removeItem(NOTICE_FLAG_KEY);
  });

  afterEach(() => {
    globalThis.localStorage?.removeItem(NOTICE_FLAG_KEY);
  });

  it("invokes the Tauri command on macOS when setting is on", async () => {
    mocks.invoke.mockResolvedValue({ stripped_count: 0, error_count: 0 });
    await maybeStripMacQuarantine("/some/workspace");
    expect(mocks.invoke).toHaveBeenCalledWith(
      "strip_workspace_quarantine_cmd",
      { root: "/some/workspace" }
    );
  });

  it("bails on non-macOS without invoking", async () => {
    mocks.isMac.mockReturnValue(false);
    await maybeStripMacQuarantine("/some/workspace");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("bails when setting is off", async () => {
    mocks.settingsState.advanced.clearMacQuarantineOnOpen = false;
    await maybeStripMacQuarantine("/some/workspace");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("bails on empty rootPath", async () => {
    await maybeStripMacQuarantine("");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("does not show toast when nothing was stripped", async () => {
    mocks.invoke.mockResolvedValue({ stripped_count: 0, error_count: 0 });
    await maybeStripMacQuarantine("/some/workspace");
    expect(mocks.toastInfo).not.toHaveBeenCalled();
  });

  it("shows toast first time something is stripped", async () => {
    mocks.invoke.mockResolvedValue({ stripped_count: 3, error_count: 0 });
    await maybeStripMacQuarantine("/some/workspace");
    expect(mocks.toastInfo).toHaveBeenCalledTimes(1);
    expect(globalThis.localStorage?.getItem(NOTICE_FLAG_KEY)).toBe("1");
  });

  it("does not show toast a second time after flag is set", async () => {
    globalThis.localStorage?.setItem(NOTICE_FLAG_KEY, "1");
    mocks.invoke.mockResolvedValue({ stripped_count: 5, error_count: 0 });
    await maybeStripMacQuarantine("/some/workspace");
    expect(mocks.toastInfo).not.toHaveBeenCalled();
  });

  it("swallows invoke errors without throwing", async () => {
    mocks.invoke.mockRejectedValue(new Error("boom"));
    await expect(maybeStripMacQuarantine("/some/workspace")).resolves.toBeUndefined();
    expect(mocks.toastInfo).not.toHaveBeenCalled();
  });
});
