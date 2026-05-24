import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const confirmOpenHugeFileMock = vi.fn();
const showHugeFileRefusalMock = vi.fn();
vi.mock("@/utils/largeFilePrompts", () => ({
  confirmOpenHugeFile: (...args: unknown[]) => confirmOpenHugeFileMock(...args),
  showHugeFileRefusal: (...args: unknown[]) => showHugeFileRefusalMock(...args),
}));

import { routeOpenBySize } from "./largeFileRouting";
import { useSettingsStore } from "@/stores/settingsStore";
import { FILE_SIZE_THRESHOLDS } from "@/utils/fileSizeThresholds";

describe("routeOpenBySize", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    confirmOpenHugeFileMock.mockReset();
    showHugeFileRefusalMock.mockReset();
    useSettingsStore.getState().resetSettings();
  });

  it("small files proceed in WYSIWYG", async () => {
    invokeMock.mockResolvedValueOnce(200 * 1024);
    const route = await routeOpenBySize("/a.md");
    expect(route).toEqual({
      proceed: true,
      forceSourceMode: false,
      sizeBytes: 200 * 1024,
      tier: "small",
    });
    expect(confirmOpenHugeFileMock).not.toHaveBeenCalled();
    expect(showHugeFileRefusalMock).not.toHaveBeenCalled();
  });

  it("large files force Source mode when autoSourceMode is on (default)", async () => {
    invokeMock.mockResolvedValueOnce(2 * 1024 * 1024);
    const route = await routeOpenBySize("/b.md");
    expect(route.proceed).toBe(true);
    expect(route.forceSourceMode).toBe(true);
    expect(route.tier).toBe("large");
    expect(confirmOpenHugeFileMock).not.toHaveBeenCalled();
  });

  it("large files stay WYSIWYG when the user disabled autoSourceMode", async () => {
    useSettingsStore.getState().updateLargeFileSetting("autoSourceMode", false);
    invokeMock.mockResolvedValueOnce(2 * 1024 * 1024);
    const route = await routeOpenBySize("/b.md");
    expect(route.proceed).toBe(true);
    expect(route.forceSourceMode).toBe(false);
    expect(route.tier).toBe("large");
  });

  it("huge files prompt and proceed to Source mode on confirm", async () => {
    invokeMock.mockResolvedValueOnce(10 * 1024 * 1024);
    confirmOpenHugeFileMock.mockResolvedValueOnce(true);

    const route = await routeOpenBySize("/c.md");

    expect(confirmOpenHugeFileMock).toHaveBeenCalledOnce();
    expect(route).toEqual({
      proceed: true,
      forceSourceMode: true,
      sizeBytes: 10 * 1024 * 1024,
      tier: "huge",
    });
  });

  it("huge files do not open when the user cancels", async () => {
    invokeMock.mockResolvedValueOnce(10 * 1024 * 1024);
    confirmOpenHugeFileMock.mockResolvedValueOnce(false);

    const route = await routeOpenBySize("/c.md");

    expect(route.proceed).toBe(false);
    expect(route.forceSourceMode).toBe(false);
  });

  it("huge files skip the prompt when warnAbove5MB is off but still force Source", async () => {
    useSettingsStore.getState().updateLargeFileSetting("warnAbove5MB", false);
    invokeMock.mockResolvedValueOnce(10 * 1024 * 1024);

    const route = await routeOpenBySize("/c.md");

    expect(confirmOpenHugeFileMock).not.toHaveBeenCalled();
    expect(route.proceed).toBe(true);
    expect(route.forceSourceMode).toBe(true);
  });

  it("refused files show the refusal dialog and do not proceed", async () => {
    invokeMock.mockResolvedValueOnce(60 * 1024 * 1024);
    showHugeFileRefusalMock.mockResolvedValueOnce(undefined);

    const route = await routeOpenBySize("/d.md");

    expect(showHugeFileRefusalMock).toHaveBeenCalledOnce();
    expect(route).toEqual({
      proceed: false,
      forceSourceMode: false,
      sizeBytes: 60 * 1024 * 1024,
      tier: "refused",
    });
  });

  it("classifies exactly at the source-mode threshold as large", async () => {
    invokeMock.mockResolvedValueOnce(FILE_SIZE_THRESHOLDS.SOURCE_MODE_DEFAULT_BYTES);
    const route = await routeOpenBySize("/boundary.md");
    expect(route.tier).toBe("large");
    expect(route.forceSourceMode).toBe(true);
  });

  it("classifies exactly at the warn threshold as huge", async () => {
    invokeMock.mockResolvedValueOnce(FILE_SIZE_THRESHOLDS.WARN_BEFORE_OPEN_BYTES);
    confirmOpenHugeFileMock.mockResolvedValueOnce(true);
    const route = await routeOpenBySize("/boundary.md");
    expect(route.tier).toBe("huge");
  });

  it("size-check errors resolve as small so the caller's error path runs", async () => {
    invokeMock.mockRejectedValueOnce(new Error("permission denied"));
    const route = await routeOpenBySize("/missing.md");
    expect(route).toEqual({
      proceed: true,
      forceSourceMode: false,
      sizeBytes: 0,
      tier: "small",
    });
  });
});
