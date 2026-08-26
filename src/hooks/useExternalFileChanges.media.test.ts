/**
 * Media tabs and the external-change watcher (issue #1328).
 *
 * A media tab holds a BINARY file whose document `content` is deliberately
 * empty — the bytes reach the webview through the asset protocol. That gives
 * the watcher two obligations here, and they pull in opposite directions:
 *
 *  1. never re-read the file as UTF-8 (it is not text, and it may be a
 *     multi-gigabyte video), and
 *  2. still TELL the viewer the bytes moved, because an <img>/<video> whose
 *     `src` attribute does not change never refetches — obligation 1 alone is
 *     what let a rewritten PNG render its original bytes indefinitely.
 *
 * Split out of `useExternalFileChanges.test.ts`, which is size-baselined and
 * had no room left; this block is self-contained (its own tab seeding and its
 * own registry) so the seam is clean.
 *
 * @coordinates-with hooks/useExternalFileChanges.ts — the reaction policy
 * @coordinates-with services/windowClose/fsChangeHandlers.ts — the media branch
 * @coordinates-with components/Editor/MediaViewer/MediaViewer.tsx — reload key
 * @module hooks/useExternalFileChanges.media.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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
import { seedTabAndDocument } from "@/test/externalFileChangesFixtures";
import { __resetRegistry } from "@/lib/formats/registry";
import { registerMarkdownFormat } from "@/lib/formats/adapters/markdown";
import { registerMediaFormat } from "@/lib/formats/adapters/media";
import { useExternalFileChanges } from "./useExternalFileChanges";

type ListenCallback = (event: { payload: { watchId: string; rootPath: string; paths: string[]; kind: string } }) => Promise<void>;

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


// A media tab (image/audio/video) holds a binary file whose document content
// is intentionally empty. The external-change watcher must NOT re-read such a
// file as UTF-8 text on a modify/create event — the bytes are not text and a
// read would surface garbage (or throw). Markdown tabs keep re-reading.
describe("useExternalFileChanges — media tabs excluded from UTF-8 re-read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listen.mockImplementation(() => Promise.resolve(() => {}));
    mocks.subscribeWorkspaceEvents.mockImplementation((_label: string, _cb: unknown) => () => {});
    mocks.activeScopeRoot.mockReturnValue(null);
    mocks.matchesPendingSave.mockReturnValue(false);
    mocks.hasPendingSave.mockReturnValue(false);
    // Real registry so getFormatById("media").kind === "media" resolves.
    __resetRegistry();
    registerMarkdownFormat();
    registerMediaFormat();
  });

  afterEach(() => {
    __resetRegistry();
  });

  /**
   * Seed one tab + its document.
   *
   * Both are built from the real constructors rather than restated field by
   * field: an object literal has to be edited every time either type gains a
   * property, and the version this was extracted from had already fallen four
   * behind (`selectedText`, `readOnly`, `hasBom`, `mode`) — invisibly, because
   * test files went untypechecked until `lint:test-types`.
   */
  /** Seed one tab + document. Shared with the other two suites so the three
   *  copies of this helper cannot drift from the real types again. */
  const seedTab = (id: string, filePath: string, formatId: string) =>
    seedTabAndDocument({ tabId: id, filePath, formatId });

  it("does NOT read a media file as text on a modify event", async () => {
    seedTab("tab-media", "/workspace/photo.png", "media");
    // If the guard were missing, this garbage would be loaded into the doc.
    mocks.readTextFile.mockResolvedValue("\u0000binary-bytes");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/photo.png"],
        kind: "modify",
      },
    });

    // The binary re-read is skipped entirely.
    expect(mocks.readTextFile).not.toHaveBeenCalled();
    // Document content stays empty — no garbage loaded.
    const doc = useDocumentStore.getState().documents["tab-media"];
    expect(doc?.content).toBe("");
  });

  // issue #1328 — the other half of "never read the binary": the viewer still
  // has to be TOLD, or it keeps rendering the bytes it decoded when the tab
  // opened. `documentId` is the signal MediaViewer turns into a fresh URL.
  it("bumps documentId on a media modify so the viewer re-fetches", async () => {
    seedTab("tab-media", "/workspace/photo.png", "media");
    mocks.readTextFile.mockResolvedValue("\u0000binary-bytes");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/photo.png"],
        kind: "modify",
      },
    });

    const doc = useDocumentStore.getState().documents["tab-media"];
    expect(doc?.documentId).toBe(1);
    // Still no text read, and the tab is not falsely dirtied.
    expect(mocks.readTextFile).not.toHaveBeenCalled();
    expect(doc?.isDirty).toBe(false);
    expect(doc?.content).toBe("");
  });

  it("bumps documentId again on each subsequent external write", async () => {
    seedTab("tab-media", "/workspace/photo.png", "media");
    const callback = await setupHookAndCallback();
    const event = {
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/photo.png"],
        kind: "modify",
      },
    };

    await callback(event);
    await callback(event);

    expect(useDocumentStore.getState().documents["tab-media"]?.documentId).toBe(2);
  });

  it("leaves documentId alone for a markdown modify (that path ingests instead)", async () => {
    // Text documents get their refresh from `ingestExternalContent`, which
    // bumps the counter itself — this must not double-count.
    seedTab("tab-md", "/workspace/notes.md", "markdown");
    mocks.readTextFile.mockResolvedValue("# updated");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/notes.md"],
        kind: "modify",
      },
    });

    expect(useDocumentStore.getState().documents["tab-md"]?.documentId).toBe(1);
  });

  it("does NOT read a media file as text on a create event (recreation)", async () => {
    seedTab("tab-media", "/workspace/clip.mp4", "media");
    mocks.readTextFile.mockResolvedValue("binary");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/clip.mp4"],
        kind: "create",
      },
    });

    expect(mocks.readTextFile).not.toHaveBeenCalled();
  });

  it("still reads a markdown file as text on a modify event (regression guard)", async () => {
    seedTab("tab-md", "/workspace/notes.md", "markdown");
    mocks.readTextFile.mockResolvedValue("# updated by external tool");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/notes.md"],
        kind: "modify",
      },
    });

    // Markdown is unaffected — the text re-read still fires and reloads.
    expect(mocks.readTextFile).toHaveBeenCalledWith("/workspace/notes.md");
    const doc = useDocumentStore.getState().documents["tab-md"];
    expect(doc?.content).toBe("# updated by external tool");
  });

  // F3 — a media file marked missing (deleted) recovers on a `create` event:
  // clear isMissing so MediaView re-streams via asset://, WITHOUT reading text.
  it("clears isMissing on a media create when the deleted file reappears", async () => {
    seedTab("tab-media", "/workspace/photo.png", "media");
    useDocumentStore.getState().markMissing("tab-media");
    mocks.readTextFile.mockResolvedValue("binary");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/photo.png"],
        kind: "create",
      },
    });

    const doc = useDocumentStore.getState().documents["tab-media"];
    expect(doc?.isMissing).toBe(false);
    // Recovery must never read the binary as text.
    expect(mocks.readTextFile).not.toHaveBeenCalled();
  });

  // F2 — rename events on a media tab must be existence-probed, never read.
  it("does NOT read a media file as text on a rename fallback", async () => {
    seedTab("tab-media", "/workspace/photo.png", "media");
    mocks.hasPendingSave.mockReturnValue(false);
    mocks.exists.mockResolvedValue(true);
    mocks.readTextFile.mockResolvedValue("binary");

    const callback = await setupHookAndCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/photo.png"],
        kind: "rename",
      },
    });

    expect(mocks.readTextFile).not.toHaveBeenCalled();
    expect(mocks.exists).toHaveBeenCalledWith("/workspace/photo.png");
    const doc = useDocumentStore.getState().documents["tab-media"];
    expect(doc?.isMissing).toBe(false);
  });
});
