/**
 * How the watcher decides a document is GONE.
 *
 * Split out of `useExternalFileChanges.test.ts` (size-baselined, and the cap
 * only ever goes down) because these cases share one question the rest of that
 * file does not ask: what counts as evidence of deletion?
 *
 * The answer used to be "any failed read", which quietly conflated three
 * different events — the file is gone, the file is unreadable but present, and
 * the reload policy threw — into one verdict, and marked documents missing that
 * were sitting on disk the whole time. Two fixtures in the original file
 * asserted a deletion while leaving `exists` at its default `true`, and passed:
 * the code could not tell the cases apart, so nothing could catch the
 * contradiction.
 *
 * These run end-to-end through the REAL document store, which is what makes
 * them worth having alongside the routing-layer tests in
 * `services/windowClose/fsChangeHandlers.test.ts` — those use a fake context and
 * cannot prove the hook actually wires `exists` into it.
 *
 * @coordinates-with services/windowClose/fsChangeHandlers.ts — readAndRouteOrMarkMissing
 * @module hooks/useExternalFileChanges.deletion.test
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// --- Hoisted mocks ---
const mocks = vi.hoisted(() => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  readTextFile: vi.fn(),
  exists: vi.fn(async () => true),
  toastInfo: vi.fn(),
  matchesPendingSave: vi.fn(() => false),
  hasPendingSave: vi.fn(() => false),
  dialogMessage: vi.fn(),
  dialogSave: vi.fn(),
  saveToPath: vi.fn(),
  reloadTabFromDisk: vi.fn(),
  activeScopeRoot: vi.fn(() => null as string | null),
  subscribeWorkspaceEvents: vi.fn((_label: string, _cb: unknown) => () => {}),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: mocks.readTextFile,
  exists: mocks.exists,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: mocks.dialogMessage,
  save: mocks.dialogSave,
}));

vi.mock("sonner", () => ({
  toast: {
    info: mocks.toastInfo,
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/services/ime/imeToast", () => ({
  imeToast: {
    info: mocks.toastInfo,
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: vi.fn(() => "main"),
}));

vi.mock("@/utils/pendingSaves", () => ({
  matchesPendingSave: mocks.matchesPendingSave,
  hasPendingSave: mocks.hasPendingSave,
}));

vi.mock("@/services/persistence/saveToPath", () => ({
  saveToPath: mocks.saveToPath,
}));

vi.mock("@/services/persistence/reloadFromDisk", () => ({
  reloadTabFromDisk: mocks.reloadTabFromDisk,
}));

vi.mock("@/services/workspaces/activeWorkspaceScope", () => ({
  getActiveWorkspaceScope: vi.fn(() => ({ rootPath: mocks.activeScopeRoot() })),
}));

vi.mock("@/services/workspaceEvents/subscribeWorkspaceEvents", () => ({
  subscribeWorkspaceEvents: mocks.subscribeWorkspaceEvents,
}));

import { useDocumentStore } from "@/stores/documentStore";
import {
  seedTabAndDocument,
  type SeedOptions,
} from "@/test/externalFileChangesFixtures";
import { useExternalFileChanges } from "./useExternalFileChanges";

type ListenCallback = (event: { payload: { watchId: string; rootPath: string; paths: string[]; kind: string } }) => Promise<void>;

const seedStores = (overrides: SeedOptions = {}) => seedTabAndDocument(overrides);

/** Map a raw fs:changed payload to the SemanticWorkspaceEvent[] the bus delivers. */
function toSemantic(payload: { rootPath: string; paths: string[]; kind: string }) {
  const { kind, paths, rootPath } = payload;
  if (kind === "rename") {
    const events = [];
    for (let i = 0; i < paths.length; i += 2) {
      const paired = i + 1 < paths.length;
      events.push({
        kind: "renamed" as const,
        path: paired ? paths[i + 1] : paths[i],
        previousPath: paired ? paths[i] : undefined,
        rootPath,
        selfWrite: false,
      });
    }
    return events;
  }
  const k: "created" | "deleted" | "modified" =
    kind === "create" ? "created" : kind === "remove" ? "deleted" : "modified";
  return paths.map((p) => ({ kind: k, path: p, rootPath, selfWrite: false }));
}

/**
 * Compat shim: the hook now subscribes to the workspace event source instead of
 * `listen("fs:changed")`. This wraps the captured subscriber so existing tests
 * keep firing the historical raw payload — it emulates the watchId scoping the
 * source now owns, converts raw → semantic, delivers to the hook, and awaits the
 * async routing so `await callback(payload)` still means "effects applied".
 */
function captureListenCallback(): ListenCallback {
  const calls = mocks.subscribeWorkspaceEvents.mock.calls as unknown as unknown[][];
  const call = calls.find((c) => typeof c[1] === "function");
  if (!call) throw new Error("subscribeWorkspaceEvents was not called");
  const listener = call[1] as (events: unknown[]) => void;
  return async ({ payload }) => {
    if (payload.watchId !== "main") return; // the source scopes by watchId
    const activeRoot = mocks.activeScopeRoot();
    if (activeRoot && payload.rootPath !== activeRoot) return; // …and by the watched root
    listener(toSemantic(payload));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
}

/** Render hook, wait for the subscription, and return the compat callback. */
async function setupHookAndCallback(): Promise<ListenCallback> {
  renderHook(() => useExternalFileChanges());
  await vi.waitFor(() => expect(mocks.subscribeWorkspaceEvents).toHaveBeenCalled());
  return captureListenCallback();
}

describe("useExternalFileChanges — what counts as deletion", () => {
  it.each([
    ["a permission error", "EACCES: permission denied"],
    ["a transient I/O error", "EIO: i/o error"],
    ["a lock held mid-write", "EBUSY: resource busy"],
  ])("does not mark a document missing on %s while the file exists", async (_l, message) => {
    seedStores();
    mocks.readTextFile.mockRejectedValue(new Error(message));
    mocks.exists.mockResolvedValue(true);

    const callback = await setupHookAndCallback();
    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "remove",
      },
    });

    expect(useDocumentStore.getState().documents["tab-1"]?.isMissing).toBe(false);
  });

  it("marks file as deleted when rename fallback cannot read the file", async () => {
    seedStores();
    mocks.hasPendingSave.mockReturnValue(false);
    mocks.readTextFile.mockRejectedValue(new Error("file not found"));
    // "Cannot read" is no longer enough on its own — an unreadable file that
    // still EXISTS (EACCES, a lock held mid-write) is not a deletion. The
    // fixture has to state the deletion it is asserting.
    mocks.exists.mockResolvedValue(false);

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "rename",
      },
    });

    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isMissing).toBe(true);
  });

  it("marks file as missing on remove event", async () => {
    seedStores();
    // Genuine deletion: file no longer readable, not one of our saves, and
    // confirmed absent — an unreadable-but-present file is not a deletion.
    mocks.readTextFile.mockRejectedValue(new Error("file not found"));
    mocks.exists.mockResolvedValue(false);

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "remove",
      },
    });

    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isMissing).toBe(true);
  });
});
