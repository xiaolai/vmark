// @vitest-environment node
/**
 * Config-mutation invariants of the workspace store (audit #1013–#1016, #1018).
 *
 * A separate file because `workspaceStore.test.ts` is at the test-size cap, and
 * because these four share one subject: what the store OWNS after a write.
 * Nothing here is mocked except the storage backend — the point is the real
 * clone/validation behaviour, and a mocked identity module would hide the very
 * nesting #1013 is about.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/services/persistence/workspaceStorage", () => ({
  windowScopedStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
}));

import { useWorkspaceStore, DEFAULT_EXCLUDED_FOLDERS } from "./workspaceStore";

beforeEach(() => {
  useWorkspaceStore.setState({ rootPath: null, config: null, isWorkspaceMode: false });
  useWorkspaceStore.getState().openWorkspace("/repo");
});

// Audit #1013 — the old field-by-field copy cloned three keys by name and
// missed `identity` and `ai`. Identity carries TRUST, so the miss meant a
// caller could flip a workspace to trusted after the fact, with no set().
describe("updateConfig deep-clones the merged config", () => {
  it("does not alias a caller-owned identity", () => {
    const identity = {
      id: "caller-owned",
      createdAt: 1,
      trustLevel: "untrusted" as const,
      trustedAt: null,
    };

    useWorkspaceStore.getState().updateConfig({ identity });
    identity.trustLevel = "trusted" as never;

    expect(useWorkspaceStore.getState().config?.identity?.trustLevel).toBe("untrusted");
    expect(useWorkspaceStore.getState().isWorkspaceTrusted()).toBe(false);
  });

  it("does not alias a caller-owned ai block", () => {
    const ai: Record<string, unknown> = { model: "a" };

    useWorkspaceStore.getState().updateConfig({ ai });
    ai.model = "b";

    expect(useWorkspaceStore.getState().config?.ai).toEqual({ model: "a" });
  });

  it("still clones the arrays it always cloned", () => {
    const excludeFolders = ["dist"];
    const lastOpenTabs = ["/a.md"];

    useWorkspaceStore.getState().updateConfig({ excludeFolders, lastOpenTabs });
    excludeFolders.push("build");
    lastOpenTabs.push("/b.md");

    expect(useWorkspaceStore.getState().config?.excludeFolders).toEqual(["dist"]);
    expect(useWorkspaceStore.getState().config?.lastOpenTabs).toEqual(["/a.md"]);
  });

  it("clones nested sessionTabs entries", () => {
    const tab = { kind: "document" as const, path: "/a.md" };
    useWorkspaceStore.getState().updateConfig({
      sessionTabs: { version: 1, tabs: [tab] },
    });
    tab.path = "/mutated.md";

    const restored = useWorkspaceStore.getState().config?.sessionTabs?.tabs[0];
    expect(restored?.kind === "document" ? restored.path : null).toBe("/a.md");
  });

  it("leaves state alone when there is no config", () => {
    useWorkspaceStore.setState({ config: null });
    useWorkspaceStore.getState().updateConfig({ showHiddenFiles: true });
    expect(useWorkspaceStore.getState().config).toBeNull();
  });
});

// Audit #1014 — isPathExcluded compares individual path SEGMENTS, so anything
// that is not one can never match. Such an entry used to persist forever while
// excluding nothing.
describe("addExcludedFolder takes a single path segment", () => {
  it.each([
    ["", "empty"],
    ["   ", "whitespace only"],
    ["src/vendor", "posix separator"],
    ["src\\vendor", "windows separator"],
    ["/", "a bare separator"],
  ])("refuses %j (%s)", (folder) => {
    const before = useWorkspaceStore.getState().config?.excludeFolders;

    useWorkspaceStore.getState().addExcludedFolder(folder);

    expect(useWorkspaceStore.getState().config?.excludeFolders).toEqual(before);
  });

  it("accepts an ordinary segment", () => {
    useWorkspaceStore.getState().addExcludedFolder("dist");
    expect(useWorkspaceStore.getState().config?.excludeFolders).toContain("dist");
  });

  it("accepts a segment with an interior space", () => {
    useWorkspaceStore.getState().addExcludedFolder("My Folder");
    expect(useWorkspaceStore.getState().config?.excludeFolders).toContain("My Folder");
  });
});

// Audit #1015 — a filter that removed nothing still wrote a fresh config,
// waking every subscriber and re-persisting for no change.
describe("removeExcludedFolder writes only on a real change", () => {
  it("keeps the same config object when the folder is absent", () => {
    const before = useWorkspaceStore.getState().config;

    useWorkspaceStore.getState().removeExcludedFolder("never-added");

    expect(useWorkspaceStore.getState().config).toBe(before);
  });

  it("notifies no subscriber when the folder is absent", () => {
    const listener = vi.fn();
    const unsubscribe = useWorkspaceStore.subscribe(listener);

    useWorkspaceStore.getState().removeExcludedFolder("never-added");
    expect(listener).not.toHaveBeenCalled();

    useWorkspaceStore.getState().removeExcludedFolder(".git");
    expect(listener).toHaveBeenCalled();

    unsubscribe();
  });

  it("still removes a folder that is there", () => {
    useWorkspaceStore.getState().removeExcludedFolder(".git");
    expect(useWorkspaceStore.getState().config?.excludeFolders).not.toContain(".git");
    expect(useWorkspaceStore.getState().config?.excludeFolders).toContain("node_modules");
  });
});

// Audit #1016 — one mutation path. setLastOpenTabs was a second copy of
// updateConfig's lastOpenTabs branch, so a fix to one could miss the other;
// this asserts they are now literally the same code by checking the deep-clone
// guarantee reaches through it.
describe("setLastOpenTabs goes through updateConfig", () => {
  it("clones the caller's array", () => {
    const tabs = ["/a.md"];
    useWorkspaceStore.getState().setLastOpenTabs(tabs);
    tabs.push("/b.md");

    expect(useWorkspaceStore.getState().config?.lastOpenTabs).toEqual(["/a.md"]);
  });

  it("replaces the previous list", () => {
    useWorkspaceStore.getState().setLastOpenTabs(["/old.md"]);
    useWorkspaceStore.getState().setLastOpenTabs(["/new.md"]);

    expect(useWorkspaceStore.getState().config?.lastOpenTabs).toEqual(["/new.md"]);
  });

  it("does nothing without a config", () => {
    useWorkspaceStore.setState({ config: null });
    useWorkspaceStore.getState().setLastOpenTabs(["/a.md"]);
    expect(useWorkspaceStore.getState().config).toBeNull();
  });

  it("leaves the rest of the config intact", () => {
    useWorkspaceStore.getState().addExcludedFolder("dist");
    useWorkspaceStore.getState().setLastOpenTabs(["/a.md"]);

    expect(useWorkspaceStore.getState().config?.excludeFolders).toContain("dist");
  });
});

// Audit #1018 — the array every future workspace copies its excludes from.
describe("DEFAULT_EXCLUDED_FOLDERS is frozen", () => {
  it("refuses a push", () => {
    expect(Object.isFrozen(DEFAULT_EXCLUDED_FOLDERS)).toBe(true);
    expect(() => (DEFAULT_EXCLUDED_FOLDERS as string[]).push("mutated")).toThrow();
    expect(DEFAULT_EXCLUDED_FOLDERS).not.toContain("mutated");
  });

  it("still seeds a new workspace", () => {
    useWorkspaceStore.setState({ config: null });
    useWorkspaceStore.getState().openWorkspace("/other");

    expect(useWorkspaceStore.getState().config?.excludeFolders).toEqual([
      ...DEFAULT_EXCLUDED_FOLDERS,
    ]);
    expect(useWorkspaceStore.getState().config?.excludeFolders).not.toBe(
      DEFAULT_EXCLUDED_FOLDERS,
    );
  });
});
