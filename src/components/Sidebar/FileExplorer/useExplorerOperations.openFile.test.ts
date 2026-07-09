// Regression lock for #1112 — the FileExplorer sidebar producer (the
// reported repro) must route opens through the window-scoped helper, not
// a raw broadcast. A future refactor back to emit("open-file", { path })
// would fail here.

import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ emitOpenFileInCurrentWindow: vi.fn(async () => undefined) }));

vi.mock("@/services/navigation/openFileEvent", () => ({
  emitOpenFileInCurrentWindow: mocks.emitOpenFileInCurrentWindow,
}));
// Trim the hook's heavy siblings — this test only exercises openFile.
vi.mock("@/stores/tabStore", () => ({ useTabStore: { getState: () => ({ tabs: [] }) } }));
vi.mock("@/services/persistence/applyPathReconciliation", () => ({ applyPathReconciliation: vi.fn() }));
vi.mock("@/services/persistence/renameFile", () => ({ renameFile: vi.fn() }));
vi.mock("@/services/dialogs/errorDialog", () => ({ showError: vi.fn(), FileErrors: {} }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: { success: vi.fn(), error: vi.fn() } }));

import { useExplorerOperations } from "./useExplorerOperations";

describe("useExplorerOperations.openFile", () => {
  it("delegates to the window-scoped open-file emitter", async () => {
    const { result } = renderHook(() => useExplorerOperations());
    await result.current.openFile("/notes/todo.md");
    expect(mocks.emitOpenFileInCurrentWindow).toHaveBeenCalledWith("/notes/todo.md");
  });
});
