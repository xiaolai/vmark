/**
 * When a queued conflict has gone stale.
 *
 * A dirty-file conflict is not resolved where it is detected. It is queued,
 * debounced for 300 ms, and — for a multi-file batch — put behind a modal the
 * user may sit on indefinitely. The entry names the tab and path captured when
 * it was QUEUED, and in that window the tab can be closed, saved or renamed.
 *
 * The decision itself is pure and unit-tested as `isQueuedConflictStillLive`
 * (`utils/openPolicy.test.ts`), which is where the four cases live as four
 * assertions. These are the other half: proof that the hook actually CONSULTS
 * it. A filter that is never called looks exactly like one that passes
 * everything, and only an end-to-end assertion can tell those apart.
 *
 * Split from `useExternalFileChanges.test.ts`, which is size-baselined and full.
 *
 * @coordinates-with utils/openPolicy/externalChangePolicy.ts — the predicate
 * @module hooks/useExternalFileChanges.staleConflict.test
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

describe("a queued conflict that went stale is not resolved", () => {
  // Audit finding #27. An entry names the tab and path captured when it was
  // QUEUED, then waits out a 300 ms debounce (and, for a multi-file batch, a
  // modal the user may sit on). The decision logic is unit-tested as
  // `isQueuedConflictStillLive`; these assert the hook actually consults it,
  // because a filter that is never called looks exactly like one that passes.
  it("does not prompt for a conflict whose tab closed during the debounce", async () => {
    seedStores({ isDirty: true });
    mocks.readTextFile.mockResolvedValue("# external change");

    const callback = await setupHookAndCallback();
    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    useDocumentStore.setState({ documents: {} });
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(mocks.dialogMessage).not.toHaveBeenCalled();
  });

  it("does not prompt for a conflict the user saved during the debounce", async () => {
    seedStores({ isDirty: true });
    mocks.readTextFile.mockResolvedValue("# external change");

    const callback = await setupHookAndCallback();
    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    // Saved while queued: the conflict resolved itself, and prompting would
    // ask the user about something that is no longer true.
    seedStores({ isDirty: false });
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(mocks.dialogMessage).not.toHaveBeenCalled();
  });
});
