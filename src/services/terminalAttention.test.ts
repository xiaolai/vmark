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
  default: { t: (key: string, opts?: { name?: string }) => (opts?.name ? `${key}|${opts.name}` : key) },
}));

// Mutable mocks for the glue path.
let mockTerminal: { notifyOnBell?: boolean; bellMode?: string } = { notifyOnBell: true, bellMode: "visual" };
let mockActiveTabTitle: string | null = "notes.md";
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: { getState: () => ({ terminal: mockTerminal }) },
}));
vi.mock("@/stores/tabStore", () => ({
  useTabStore: { getState: () => ({ getActiveTab: () => (mockActiveTabTitle ? { title: mockActiveTabTitle } : null) }) },
}));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

import {
  shouldNotifyOnBell,
  notifyTerminalAttention,
  maybeNotifyTerminalBell,
  _resetNotificationState,
} from "./terminalAttention";

beforeEach(() => {
  vi.clearAllMocks();
  _resetNotificationState();
  mockTerminal = { notifyOnBell: true, bellMode: "visual" };
  mockActiveTabTitle = "notes.md";
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
});

describe("shouldNotifyOnBell", () => {
  it("notifies only when enabled, bell not muted, and the window is unfocused", () => {
    expect(shouldNotifyOnBell(true, false, "visual")).toBe(true);
    expect(shouldNotifyOnBell(true, false, "audible")).toBe(true);
    expect(shouldNotifyOnBell(true, true, "visual")).toBe(false); // focused
    expect(shouldNotifyOnBell(false, false, "visual")).toBe(false); // disabled
    expect(shouldNotifyOnBell(true, false, "off")).toBe(false); // bell muted
  });
});

describe("notifyTerminalAttention", () => {
  it("sends a notification naming the window when permission is already granted", async () => {
    mockIsGranted.mockResolvedValue(true);
    await notifyTerminalAttention("notes.md");
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith({ title: "VMark", body: "statusbar:terminal.notify.attention|notes.md" });
  });

  it("requests permission once, then sends if granted", async () => {
    mockIsGranted.mockResolvedValue(false);
    mockRequest.mockResolvedValue("granted");
    await notifyTerminalAttention("a.md");
    expect(mockRequest).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("caches explicit denial — never re-prompts", async () => {
    mockIsGranted.mockResolvedValue(false);
    mockRequest.mockResolvedValue("denied");
    await notifyTerminalAttention("a.md");
    await notifyTerminalAttention("b.md");
    expect(mockRequest).toHaveBeenCalledOnce();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does NOT cache a dismissed (\"default\") prompt — retries next time", async () => {
    mockIsGranted.mockResolvedValue(false);
    mockRequest.mockResolvedValue("default");
    await notifyTerminalAttention("a.md");
    await notifyTerminalAttention("b.md");
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it("dedupes a single concurrent permission request across simultaneous bells", async () => {
    mockIsGranted.mockResolvedValue(false);
    mockRequest.mockResolvedValue("granted");
    await Promise.all([notifyTerminalAttention("a.md"), notifyTerminalAttention("b.md")]);
    expect(mockRequest).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("throttles repeated notifications for the same window", async () => {
    mockIsGranted.mockResolvedValue(true);
    await notifyTerminalAttention("notes.md");
    await notifyTerminalAttention("notes.md");
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("swallows errors — never throws into the terminal data path", async () => {
    mockIsGranted.mockRejectedValue(new Error("boom"));
    await expect(notifyTerminalAttention("a.md")).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("maybeNotifyTerminalBell", () => {
  it("notifies with the active document title when unfocused + enabled", async () => {
    mockIsGranted.mockResolvedValue(true);
    maybeNotifyTerminalBell();
    await vi.waitFor(() => expect(mockSend).toHaveBeenCalledWith({
      title: "VMark",
      body: "statusbar:terminal.notify.attention|notes.md",
    }));
  });

  it("does nothing when the window is focused", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    mockIsGranted.mockResolvedValue(true);
    maybeNotifyTerminalBell();
    await Promise.resolve();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does nothing when bell mode is off", async () => {
    mockTerminal = { notifyOnBell: true, bellMode: "off" };
    mockIsGranted.mockResolvedValue(true);
    maybeNotifyTerminalBell();
    await Promise.resolve();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does nothing when notifyOnBell is disabled", async () => {
    mockTerminal = { notifyOnBell: false, bellMode: "visual" };
    mockIsGranted.mockResolvedValue(true);
    maybeNotifyTerminalBell();
    await Promise.resolve();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("falls back to a localized label when there is no active tab", async () => {
    mockActiveTabTitle = null;
    mockIsGranted.mockResolvedValue(true);
    maybeNotifyTerminalBell();
    await vi.waitFor(() => expect(mockSend).toHaveBeenCalledWith({
      title: "VMark",
      body: "statusbar:terminal.notify.attention|statusbar:terminal.ariaLabel",
    }));
  });
});
