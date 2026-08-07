// Title-bar rename must preserve the open file's real extension — renaming
// config.yaml must not coerce it to .md. The hook delegates to the shared
// renameFile service (which owns extension preservation + reconciliation)
// and maps its outcome to the boolean the TitleBar input expects.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { RenameOutcome } from "@/services/persistence/renameFile";

const mockRenameService = vi.fn();

vi.mock("@/services/persistence/renameFile", () => ({
  renameFile: (...args: unknown[]) => mockRenameService(...args),
}));

import { useTitleBarRename } from "./useTitleBarRename";

function outcome(o: RenameOutcome) {
  mockRenameService.mockResolvedValue(o);
}

beforeEach(() => {
  vi.clearAllMocks();
  outcome({ status: "renamed", newPath: "/docs/config2.yaml" });
});

describe("useTitleBarRename", () => {
  it("delegates to the shared rename service as a file (isFolder: false)", async () => {
    const { result } = renderHook(() => useTitleBarRename());
    let ok = false;
    await act(async () => {
      ok = await result.current.renameFile("/docs/config.yaml", "config2");
    });
    expect(ok).toBe(true);
    expect(mockRenameService).toHaveBeenCalledWith("/docs/config.yaml", "config2", {
      isFolder: false,
      preserveExtension: true,
    });
  });

  // #1224 — the title bar now shows the extension by default, so what the user
  // typed is final. Re-attaching there silently undoes a deliberate deletion.
  it("forwards preserveExtension: false when the editor showed the extension", async () => {
    const { result } = renderHook(() => useTitleBarRename());
    await act(async () => {
      await result.current.renameFile("/docs/config.yaml", "config2", {
        preserveExtension: false,
      });
    });
    expect(mockRenameService).toHaveBeenCalledWith("/docs/config.yaml", "config2", {
      isFolder: false,
      preserveExtension: false,
    });
  });

  it("returns true when the name is unchanged", async () => {
    outcome({ status: "unchanged", path: "/docs/note.md" });
    const { result } = renderHook(() => useTitleBarRename());
    let ok = false;
    await act(async () => {
      ok = await result.current.renameFile("/docs/note.md", "note");
    });
    expect(ok).toBe(true);
  });

  it("returns false when the target already exists (stay in edit mode)", async () => {
    outcome({ status: "exists", name: "taken.yaml", isFile: true });
    const { result } = renderHook(() => useTitleBarRename());
    let ok = true;
    await act(async () => {
      ok = await result.current.renameFile("/docs/config.yaml", "taken");
    });
    expect(ok).toBe(false);
  });

  it("returns false when the rename errors", async () => {
    outcome({ status: "error", error: new Error("EACCES") });
    const { result } = renderHook(() => useTitleBarRename());
    let ok = true;
    await act(async () => {
      ok = await result.current.renameFile("/docs/note.md", "note2");
    });
    expect(ok).toBe(false);
  });

  it("guards against re-entry while a rename is in flight", async () => {
    let release: (o: RenameOutcome) => void = () => {};
    mockRenameService.mockImplementation(
      () => new Promise<RenameOutcome>((res) => (release = res)),
    );
    const { result } = renderHook(() => useTitleBarRename());
    let first: Promise<boolean> | undefined;
    let second = true;
    await act(async () => {
      first = result.current.renameFile("/docs/note.md", "note2");
      second = await result.current.renameFile("/docs/note.md", "note3");
      release({ status: "renamed", newPath: "/docs/note2.md" });
      await first;
    });
    expect(second).toBe(false);
    expect(mockRenameService).toHaveBeenCalledTimes(1);
  });
});
