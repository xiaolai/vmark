import { describe, it, expect, vi, beforeEach } from "vitest";

const mockIsGranted = vi.fn();
const mockRequest = vi.fn();
const mockSend = vi.fn();

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => mockIsGranted(),
  requestPermission: () => mockRequest(),
  sendNotification: (...args: unknown[]) => mockSend(...args),
}));

vi.mock("@/i18n", () => ({
  default: { t: (key: string, opts?: { name?: string }) => `${key}|${opts?.name ?? ""}` },
}));

import {
  shouldNotifyOnBell,
  notifyTerminalAttention,
  _resetNotificationPermissionCache,
} from "./terminalAttention";

beforeEach(() => {
  vi.clearAllMocks();
  _resetNotificationPermissionCache();
});

describe("shouldNotifyOnBell", () => {
  it("notifies only when enabled and the window is unfocused", () => {
    expect(shouldNotifyOnBell(true, false)).toBe(true);
    expect(shouldNotifyOnBell(true, true)).toBe(false);
    expect(shouldNotifyOnBell(false, false)).toBe(false);
    expect(shouldNotifyOnBell(false, true)).toBe(false);
  });
});

describe("notifyTerminalAttention", () => {
  it("sends a notification naming the window when permission is already granted", async () => {
    mockIsGranted.mockResolvedValue(true);
    await notifyTerminalAttention("notes.md");
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith({
      title: "VMark",
      body: "statusbar:terminal.notify.attention|notes.md",
    });
  });

  it("requests permission when not yet granted, then sends if granted", async () => {
    mockIsGranted.mockResolvedValue(false);
    mockRequest.mockResolvedValue("granted");
    await notifyTerminalAttention("a.md");
    expect(mockRequest).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("does not send when permission is denied, and caches the denial (no re-prompt)", async () => {
    mockIsGranted.mockResolvedValue(false);
    mockRequest.mockResolvedValue("denied");
    await notifyTerminalAttention("a.md");
    await notifyTerminalAttention("b.md");
    expect(mockRequest).toHaveBeenCalledOnce(); // second call short-circuits
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("swallows errors — never throws into the terminal data path", async () => {
    mockIsGranted.mockRejectedValue(new Error("boom"));
    await expect(notifyTerminalAttention("a.md")).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
