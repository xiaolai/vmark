// Regression tests for #1112 — the "open-file" event must carry the
// originating window's label so the listener can drop broadcasts from
// other windows (Tauri's window.emit() reaches EVERY window; only the
// payload filter scopes it).

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emit: vi.fn(async () => undefined),
  label: "window-2",
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: mocks.label, emit: mocks.emit }),
}));

import { emitOpenFileInCurrentWindow, OPEN_FILE_EVENT } from "./openFileEvent";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("emitOpenFileInCurrentWindow", () => {
  it("emits open-file with the path AND the originating window label", async () => {
    await emitOpenFileInCurrentWindow("/notes/todo.md");
    expect(mocks.emit).toHaveBeenCalledWith(OPEN_FILE_EVENT, {
      path: "/notes/todo.md",
      windowLabel: "window-2",
    });
  });

  it("uses the live window label at call time", async () => {
    mocks.label = "main";
    await emitOpenFileInCurrentWindow("/a.md");
    expect(mocks.emit).toHaveBeenCalledWith(OPEN_FILE_EVENT, {
      path: "/a.md",
      windowLabel: "main",
    });
    mocks.label = "window-2";
  });

  it("propagates emit failures to the caller (callers own error handling)", async () => {
    mocks.emit.mockRejectedValueOnce(new Error("ipc down"));
    await expect(emitOpenFileInCurrentWindow("/b.md")).rejects.toThrow("ipc down");
  });
});
