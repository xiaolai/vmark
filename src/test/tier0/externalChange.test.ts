// WI-17 — Tier-0 EXTERNAL-CHANGE flow over the REAL composition: the real
// useExternalFileChanges hook, the real workspace event pipeline (normalize →
// suppress → coalesce → batch queue) and the real dirty-change resolver, driven
// by a real `fs:changed` emission against the stateful fs fake.
//
// The save-vs-external-change protocol these tests pin — winner, disk bytes,
// dirty state, mtime semantics, notification — is decision ledger entry **D6**
// (.claude/tdd-guardian/decisions-20260803.md). Read it before changing an
// expectation here: the invariant is that no unsaved user bytes are silently
// discarded and no external bytes are silently overwritten without a flagged
// conflict.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.fsModule();
});
vi.mock("@tauri-apps/api/core", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.coreModule();
});
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
  open: vi.fn(),
  message: vi.fn(),
  ask: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
  emit: vi.fn(),
}));

import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { message as dialogMessage } from "@tauri-apps/plugin-dialog";
import { WindowContext } from "@/contexts/WindowContext";
import { useExternalFileChanges } from "@/hooks/useExternalFileChanges";
import { handleSave } from "@/services/files/fileSave";
import { useSettingsStore } from "@/stores/settingsStore";
import { _resetWorkspaceEventSources } from "@/services/workspaceEvents/subscribeWorkspaceEvents";
import { statefulFs } from "@/test/statefulFsFake";
import { WINDOW, ROOT, resetTier0, openDocInTab, editDoc, doc, settle } from "./harness";

const DOC = `${ROOT}/shared.md`;
const ON_DISK = "# 共享文件\n\n原始内容。\n";
const EXTERNAL = "# 共享文件\n\n别的程序写的内容。\n";
const LOCAL_EDIT = "# 共享文件\n\n我的未保存修改。\n";

/** Handlers registered by the real pipeline through the mocked `listen`. */
const fsListeners: ((e: { payload: unknown }) => void)[] = [];

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    WindowContext.Provider,
    { value: { windowLabel: WINDOW, isDocumentWindow: true } },
    children,
  );
}

/** Emit one raw watcher event the way Rust does, then let the pipeline run. */
async function emitFsChange(kind: string, paths: string[]): Promise<void> {
  for (const handler of fsListeners) handler({ payload: { watchId: WINDOW, kind, paths } });
  await settle();
  await vi.advanceTimersByTimeAsync(60); // bus coalesce window
  await settle();
  await vi.advanceTimersByTimeAsync(400); // dirty-change batch debounce
  await settle();
}

beforeEach(() => {
  resetTier0();
  // History OFF: it is awaited inside the save and hashes via
  // `crypto.subtle.digest`, which cannot settle while the fake clock owns
  // every timer (same reasoning as autosaveFlow.test.ts). saveFlow.test.ts
  // exercises the history composition for real.
  useSettingsStore.setState((s) => ({ general: { ...s.general, historyEnabled: false } }));
  fsListeners.length = 0;
  _resetWorkspaceEventSources();
  vi.mocked(listen).mockImplementation((_event: string, handler: never) => {
    fsListeners.push(handler as unknown as (e: { payload: unknown }) => void);
    return Promise.resolve(() => {});
  });
  vi.mocked(dialogMessage).mockReset();
  vi.useFakeTimers();
});

afterEach(async () => {
  await settle();
  vi.useRealTimers();
  _resetWorkspaceEventSources();
});

describe("Tier-0 external change — clean document (case 5)", () => {
  it("adopts the new bytes: content, saved baseline and disk baseline all move", async () => {
    const tabId = await openDocInTab(DOC, ON_DISK);
    const view = renderHook(() => useExternalFileChanges(), { wrapper });
    await settle();

    statefulFs.externalWrite(DOC, EXTERNAL, { mtimeMs: 1_800_000_000_000 });
    await emitFsChange("modify", [DOC]);

    const record = doc(tabId);
    expect(record.content).toBe(EXTERNAL);
    expect(record.savedContent).toBe(EXTERNAL);
    expect(record.lastDiskContent).toBe(EXTERNAL);
    expect(record.isDirty).toBe(false);
    expect(record.isDivergent).toBe(false);
    // No dialog: a clean document has nothing to lose.
    expect(dialogMessage).not.toHaveBeenCalled();
    view.unmount();
  });

  it("mtime alone is NOT the signal — identical bytes with a newer mtime change nothing", async () => {
    const tabId = await openDocInTab(DOC, ON_DISK);
    const view = renderHook(() => useExternalFileChanges(), { wrapper });
    await settle();
    const before = doc(tabId).documentId;

    // A touch: same bytes, later mtime (D6 — detection is content identity).
    statefulFs.setMtime(DOC, statefulFs.mtimeOf(DOC) + 60_000);
    await emitFsChange("modify", [DOC]);

    expect(doc(tabId).documentId).toBe(before); // no reload, no editor remount
    expect(doc(tabId).content).toBe(ON_DISK);

    // …and the pipeline really is live: change the BYTES and it reloads.
    statefulFs.externalWrite(DOC, EXTERNAL);
    await emitFsChange("modify", [DOC]);
    expect(doc(tabId).content).toBe(EXTERNAL);
    expect(doc(tabId).documentId).toBeGreaterThan(before);
    view.unmount();
  });

  it("a deleted file is flagged missing, and its buffer is kept", async () => {
    const tabId = await openDocInTab(DOC, ON_DISK);
    const view = renderHook(() => useExternalFileChanges(), { wrapper });
    await settle();

    statefulFs.reset();
    statefulFs.mkdirp(ROOT);
    await emitFsChange("remove", [DOC]);

    expect(doc(tabId).isMissing).toBe(true);
    expect(doc(tabId).content).toBe(ON_DISK); // nothing discarded
    view.unmount();
  });
});

describe("Tier-0 external change — dirty document (case 6)", () => {
  it("keep-my-changes: the local buffer is UNCHANGED, the doc goes divergent, disk keeps the external bytes", async () => {
    const tabId = await openDocInTab(DOC, ON_DISK);
    editDoc(tabId, LOCAL_EDIT);
    const view = renderHook(() => useExternalFileChanges(), { wrapper });
    await settle();
    vi.mocked(dialogMessage).mockResolvedValue("Cancel"); // Keep my changes

    statefulFs.externalWrite(DOC, EXTERNAL);
    await emitFsChange("modify", [DOC]);

    expect(dialogMessage).toHaveBeenCalledTimes(1); // the user WAS asked
    const record = doc(tabId);
    expect(record.content).toBe(LOCAL_EDIT); // ← the Tier-0 catastrophe guard
    expect(record.isDirty).toBe(true);
    expect(record.isDivergent).toBe(true);
    expect(record.lastDiskContent).toBe(EXTERNAL); // baseline adopted, content not
    expect(statefulFs.read(DOC)).toBe(EXTERNAL); // disk untouched by VMark
    view.unmount();
  });

  it("reload-from-disk discards the local edit only because the user chose it", async () => {
    const tabId = await openDocInTab(DOC, ON_DISK);
    editDoc(tabId, LOCAL_EDIT);
    const view = renderHook(() => useExternalFileChanges(), { wrapper });
    await settle();
    vi.mocked(dialogMessage).mockResolvedValue("No"); // Reload

    statefulFs.externalWrite(DOC, EXTERNAL);
    await emitFsChange("modify", [DOC]);

    expect(doc(tabId).content).toBe(EXTERNAL);
    expect(doc(tabId).isDirty).toBe(false);
    view.unmount();
  });

  it("a divergent document is not re-prompted for the same bytes", async () => {
    const tabId = await openDocInTab(DOC, ON_DISK);
    editDoc(tabId, LOCAL_EDIT);
    const view = renderHook(() => useExternalFileChanges(), { wrapper });
    await settle();
    vi.mocked(dialogMessage).mockResolvedValue("Cancel");

    statefulFs.externalWrite(DOC, EXTERNAL);
    await emitFsChange("modify", [DOC]);
    await emitFsChange("modify", [DOC]); // same bytes again (cloud sync echo)

    expect(dialogMessage).toHaveBeenCalledTimes(1);
    expect(doc(tabId).content).toBe(LOCAL_EDIT);
    view.unmount();
  });
});

describe("Tier-0 save racing an external change (case 8, D6)", () => {
  it("an OBSERVED external change is resolved before the save — the user's answer decides disk", async () => {
    const tabId = await openDocInTab(DOC, ON_DISK);
    editDoc(tabId, LOCAL_EDIT);
    const view = renderHook(() => useExternalFileChanges(), { wrapper });
    await settle();
    vi.mocked(dialogMessage).mockResolvedValue("Cancel"); // Keep my changes

    statefulFs.externalWrite(DOC, EXTERNAL);
    await emitFsChange("modify", [DOC]);
    // The conflict was flagged; the user then saves deliberately.
    await handleSave(WINDOW);
    await settle();

    expect(statefulFs.read(DOC)).toBe(LOCAL_EDIT); // the save wins the file
    expect(doc(tabId).isDirty).toBe(false);
    expect(doc(tabId).isDivergent).toBe(false); // resolved by the save
    expect(doc(tabId).lastDiskContent).toBe(LOCAL_EDIT);
    view.unmount();
  });

  it("an UNOBSERVED external write landing mid-save: the save wins the file and the doc's disk baseline is what was written", async () => {
    const tabId = await openDocInTab(DOC, ON_DISK);
    editDoc(tabId, LOCAL_EDIT);
    const view = renderHook(() => useExternalFileChanges(), { wrapper });
    await settle();
    // The external writer lands INSIDE the save's write, before our bytes.
    // No watcher event can precede it — this is the window D6 documents.
    statefulFs.stubCommand("atomic_write_file", (args) => {
      statefulFs.externalWrite(DOC, EXTERNAL);
      statefulFs.seed(String(args.path), String(args.content));
      return undefined;
    });

    await handleSave(WINDOW);
    await settle();

    // Last writer wins the file; the user's bytes are never the casualty.
    expect(statefulFs.read(DOC)).toBe(LOCAL_EDIT);
    expect(doc(tabId).isDirty).toBe(false);
    expect(doc(tabId).lastDiskContent).toBe(LOCAL_EDIT);
    view.unmount();
  });

  it("the self-write echo of a save is not mistaken for an external change", async () => {
    const tabId = await openDocInTab(DOC, ON_DISK);
    editDoc(tabId, LOCAL_EDIT);
    const view = renderHook(() => useExternalFileChanges(), { wrapper });
    await settle();

    await handleSave(WINDOW);
    await settle();
    await emitFsChange("modify", [DOC]); // the watcher reporting our own write

    expect(dialogMessage).not.toHaveBeenCalled();
    expect(doc(tabId).content).toBe(LOCAL_EDIT);
    expect(doc(tabId).isDirty).toBe(false);
    expect(statefulFs.read(DOC)).toBe(LOCAL_EDIT);
    view.unmount();
  });

  it("a write that FAILS while an external change is pending discards nothing", async () => {
    const tabId = await openDocInTab(DOC, ON_DISK);
    editDoc(tabId, LOCAL_EDIT);
    const view = renderHook(() => useExternalFileChanges(), { wrapper });
    await settle();
    vi.mocked(dialogMessage).mockResolvedValue("Cancel");

    statefulFs.externalWrite(DOC, EXTERNAL);
    await emitFsChange("modify", [DOC]);
    statefulFs.failWrites(new Error("disk full"));
    await handleSave(WINDOW);
    await settle();

    expect(doc(tabId).content).toBe(LOCAL_EDIT); // buffer intact
    expect(doc(tabId).isDirty).toBe(true); // still unsaved, loudly
    expect(statefulFs.read(DOC)).toBe(EXTERNAL); // external bytes intact
    view.unmount();
  });
});
