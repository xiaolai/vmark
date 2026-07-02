import { describe, it, expect, beforeEach } from "vitest";
import { useTabRenameStore } from "./tabRenameStore";

beforeEach(() => {
  useTabRenameStore.setState({ renamingTabId: null });
});

describe("tabRenameStore", () => {
  it("starts with no tab renaming", () => {
    expect(useTabRenameStore.getState().renamingTabId).toBeNull();
  });

  it("startRename sets the renaming tab id", () => {
    useTabRenameStore.getState().startRename("tab-1");
    expect(useTabRenameStore.getState().renamingTabId).toBe("tab-1");
  });

  it("startRename replaces the previous tab (only one at a time)", () => {
    useTabRenameStore.getState().startRename("tab-1");
    useTabRenameStore.getState().startRename("tab-2");
    expect(useTabRenameStore.getState().renamingTabId).toBe("tab-2");
  });

  it("stopRename clears the renaming tab id", () => {
    useTabRenameStore.getState().startRename("tab-1");
    useTabRenameStore.getState().stopRename();
    expect(useTabRenameStore.getState().renamingTabId).toBeNull();
  });
});
