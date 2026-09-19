// @vitest-environment node
/**
 * Tests for the shared "hand this file to the OS" door (#1428).
 *
 * @module services/navigation/openWithDefaultApp.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOpenPath = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: (...args: unknown[]) => mockOpenPath(...args),
}));

const mockBasename = vi.fn();
vi.mock("@tauri-apps/api/path", () => ({
  basename: (...args: unknown[]) => mockBasename(...args),
}));

const mockToastError = vi.fn();
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

vi.mock("@/i18n", () => ({
  default: { t: (key: string, vars?: Record<string, unknown>) => `${key}:${vars?.name ?? ""}` },
}));

import { openWithDefaultApp } from "./openWithDefaultApp";

beforeEach(() => {
  vi.clearAllMocks();
  mockBasename.mockResolvedValue("archive.zip");
});

describe("openWithDefaultApp", () => {
  it("hands the path to the system opener", async () => {
    mockOpenPath.mockResolvedValue(undefined);
    await openWithDefaultApp("/ws/archive.zip");
    expect(mockOpenPath).toHaveBeenCalledWith("/ws/archive.zip");
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("reports a refusal as a named toast instead of rejecting", async () => {
    mockOpenPath.mockRejectedValue(new Error("no default app"));
    await expect(openWithDefaultApp("/ws/archive.zip")).resolves.toBeUndefined();
    expect(mockToastError).toHaveBeenCalledWith(
      "dialog:toast.failedToOpenWithDefaultApp:archive.zip",
    );
  });

  it("still reports when the name cannot be derived", async () => {
    mockOpenPath.mockRejectedValue(new Error("no default app"));
    mockBasename.mockRejectedValue(new Error("bad path"));
    await expect(openWithDefaultApp("/ws/archive.zip")).resolves.toBeUndefined();
    // Falls back to the raw path rather than swallowing the failure silently.
    expect(mockToastError).toHaveBeenCalledWith(
      "dialog:toast.failedToOpenWithDefaultApp:/ws/archive.zip",
    );
  });
});
