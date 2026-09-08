// @vitest-environment node
/**
 * Audit #1012 — `openWorkspace("")` used to set `isWorkspaceMode: true` beside
 * a falsy `rootPath`, a pair every consumer reads as CLOSED: `bootstrapConfig`
 * returns early on `!rootPath` and `updateWorkspaceConfig` refuses the write.
 * The window then sat in a workspace mode nothing could bootstrap or configure.
 *
 * Split from workspaceStore.test.ts, which is at the test-file size limit.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useWorkspaceStore } from "./workspaceStore";

vi.mock("@/services/persistence/workspaceStorage", () => ({
  windowScopedStorage: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() },
}));

vi.mock("@/utils/debug", () => ({ workspaceError: vi.fn() }));

beforeEach(() => {
  useWorkspaceStore.setState({ rootPath: null, config: null, isWorkspaceMode: false });
});

describe("openWorkspace rejects a blank root (#1012)", () => {
  it.each(["", "   ", "\t\n"])("ignores %j", (blank) => {
    useWorkspaceStore.getState().openWorkspace(blank);
    const state = useWorkspaceStore.getState();
    expect(state.isWorkspaceMode).toBe(false);
    expect(state.rootPath).toBeNull();
    expect(state.config).toBeNull();
  });

  it("leaves an already-open workspace untouched", () => {
    useWorkspaceStore.getState().openWorkspace("/real/ws");
    useWorkspaceStore.getState().openWorkspace("");
    expect(useWorkspaceStore.getState().rootPath).toBe("/real/ws");
    expect(useWorkspaceStore.getState().isWorkspaceMode).toBe(true);
  });

  it("keeps a path whose own name has surrounding spaces", () => {
    // Trimming a real path would corrupt it — only a blank one is refused.
    useWorkspaceStore.getState().openWorkspace("/ws/ spaced ");
    expect(useWorkspaceStore.getState().rootPath).toBe("/ws/ spaced ");
    expect(useWorkspaceStore.getState().isWorkspaceMode).toBe(true);
  });
});
