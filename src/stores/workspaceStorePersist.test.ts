// @vitest-environment node
/**
 * Rehydration normalization (audit #1017).
 *
 * The store's own suite is at the test-size cap, and this is a distinct
 * subject anyway: state coming back from STORAGE, which this session did not
 * write and therefore cannot assume the shape of.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const storageEntries = new Map<string, string>();

vi.mock("@/services/persistence/workspaceStorage", () => ({
  windowScopedStorage: {
    getItem: (name: string) => storageEntries.get(name) ?? null,
    setItem: (name: string, value: string) => void storageEntries.set(name, value),
    removeItem: (name: string) => void storageEntries.delete(name),
  },
}));

import { normalizeRehydratedConfig } from "./workspaceStorePersist";
import { useWorkspaceStore } from "./workspaceStore";
import { DEFAULT_EXCLUDED_FOLDERS } from "./workspaceConfigDefaults";

/** A config as an older build wrote it: no identity, no arrays. */
const LEGACY_CONFIG = { version: 1, showHiddenFiles: true, showAllFiles: false };

beforeEach(() => {
  storageEntries.clear();
  useWorkspaceStore.setState({ rootPath: null, config: null, isWorkspaceMode: false });
});

describe("normalizeRehydratedConfig", () => {
  it("passes null through", () => {
    expect(normalizeRehydratedConfig(null)).toBeNull();
    expect(normalizeRehydratedConfig(undefined)).toBeNull();
  });

  it.each([["a string"], [42], [[1, 2, 3]], [true]])(
    "discards a persisted config that is not an object: %j",
    (value) => {
      expect(normalizeRehydratedConfig(value)).toBeNull();
    },
  );

  it("fills defaults and mints an identity for a legacy config", () => {
    const config = normalizeRehydratedConfig({ ...LEGACY_CONFIG });

    expect(config?.excludeFolders).toEqual([...DEFAULT_EXCLUDED_FOLDERS]);
    expect(config?.lastOpenTabs).toEqual([]);
    expect(config?.identity?.id).toBeTruthy();
    // The user's own setting survives normalization.
    expect(config?.showHiddenFiles).toBe(true);
  });

  it("does not alias the module defaults", () => {
    const config = normalizeRehydratedConfig({ ...LEGACY_CONFIG });
    expect(config?.excludeFolders).not.toBe(DEFAULT_EXCLUDED_FOLDERS);
  });

  it("keeps an identity the persisted config already had", () => {
    const identity = { id: "disk-id", createdAt: 1, trustLevel: "trusted" as const, trustedAt: 2 };
    const config = normalizeRehydratedConfig({ ...LEGACY_CONFIG, identity });

    expect(config?.identity?.id).toBe("disk-id");
    // …and it is a COPY: mutating what came out of storage must not reach state.
    expect(config?.identity).not.toBe(identity);
  });
});

// The wiring, not just the helper: `merge` is the only hook on this path, and
// a store that stopped calling it would still pass every test above.
describe("rehydrate() normalizes what storage hands back", () => {
  function seedStorage(state: Record<string, unknown>): void {
    storageEntries.set("vmark-workspace", JSON.stringify({ state, version: 0 }));
  }

  it("normalizes a legacy persisted config on rehydrate", async () => {
    seedStorage({ rootPath: "/repo", isWorkspaceMode: true, config: { ...LEGACY_CONFIG } });

    await useWorkspaceStore.persist.rehydrate();

    const state = useWorkspaceStore.getState();
    expect(state.rootPath).toBe("/repo");
    expect(state.isWorkspaceMode).toBe(true);
    // Without the merge hook these are undefined, and every action that reads
    // them — isPathExcluded, addExcludedFolder — breaks on a shape the store
    // promises can never occur.
    expect(state.config?.excludeFolders).toEqual([...DEFAULT_EXCLUDED_FOLDERS]);
    expect(state.config?.identity?.id).toBeTruthy();
    expect(state.isWorkspaceTrusted()).toBe(false);
  });

  it("survives a persisted config that is not an object", async () => {
    seedStorage({ rootPath: "/repo", isWorkspaceMode: true, config: "corrupted" });

    await useWorkspaceStore.persist.rehydrate();

    expect(useWorkspaceStore.getState().config).toBeNull();
    expect(useWorkspaceStore.getState().rootPath).toBe("/repo");
  });

  it("leaves a window with no persisted workspace alone", async () => {
    seedStorage({ rootPath: null, isWorkspaceMode: false, config: null });

    await useWorkspaceStore.persist.rehydrate();

    expect(useWorkspaceStore.getState().config).toBeNull();
    expect(useWorkspaceStore.getState().rootPath).toBeNull();
  });

  it("keeps the store's actions callable after a merge", async () => {
    seedStorage({ rootPath: "/repo", isWorkspaceMode: true, config: { ...LEGACY_CONFIG } });

    await useWorkspaceStore.persist.rehydrate();
    useWorkspaceStore.getState().addExcludedFolder("dist");

    expect(useWorkspaceStore.getState().config?.excludeFolders).toContain("dist");
  });
});
