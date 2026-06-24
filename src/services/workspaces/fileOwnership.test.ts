import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore, type Tab } from "@/stores/tabStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import {
  applyFileOwnershipAfterOpen,
  resolveFileOpenOwnership,
  resolveWritableFileOwnership,
  setDocumentReadOnlyWithOwnership,
  toggleDocumentReadOnlyWithOwnership,
} from "./fileOwnership";

const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}));
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: mockToastError },
}));

vi.mock("@/i18n", () => ({
  default: {
    t: (key: string) => key,
  },
}));

function enableRailMode(enabled = true): void {
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: enabled },
  });
}

function addWorkspaceInstance(
  windowLabel: string,
  workspaceInstanceId: string,
  rootPath: string,
): void {
  const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
  if (!root.ok) throw new Error("test root should be valid");
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(
    createWorkspaceInstance({
      workspaceInstanceId,
      root: root.root,
      ownerWindowLabel: windowLabel,
      createdFrom: "open",
    }),
  );
}

function addTab(
  windowLabel: string,
  tabId: string,
  filePath: string,
  options: { dirty?: boolean; readOnly?: boolean } = {},
): void {
  const tab: Tab = { id: tabId, filePath, title: tabId, isPinned: false, formatId: "markdown" };
  useTabStore.setState((state) => ({
    tabs: { ...state.tabs, [windowLabel]: [...(state.tabs[windowLabel] ?? []), tab] },
    activeTabId: { ...state.activeTabId, [windowLabel]: tabId },
  }));
  useDocumentStore.getState().initDocument(tabId, "saved", filePath);
  if (options.dirty) useDocumentStore.getState().setContent(tabId, "dirty");
  if (options.readOnly) useDocumentStore.getState().setReadOnly(tabId, true);
}

beforeEach(() => {
  enableRailMode(false);
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
  useDocumentStore.setState({ documents: {} });
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  mockToastError.mockClear();
});

describe("file ownership", () => {
  it("keeps legacy behavior while workspace rail mode is disabled", () => {
    addTab("main", "tab-a", "/repo/notes.md", { dirty: true });
    addTab("doc-1", "tab-b", "/repo/notes.md");

    expect(resolveFileOpenOwnership("/repo/notes.md", { currentTabId: "tab-b" })).toMatchObject({
      mode: "disabled",
    });
    expect(resolveWritableFileOwnership("tab-b", "/repo/notes.md")).toMatchObject({
      ok: true,
      mode: "disabled",
    });
  });

  it("allows a file with no other open claim to stay writable", () => {
    enableRailMode();
    addWorkspaceInstance("main", "wsi-main", "/repo");
    addTab("main", "tab-a", "/repo/notes.md");

    expect(resolveFileOpenOwnership("/repo/notes.md", { currentTabId: "tab-a" })).toMatchObject({
      mode: "writable",
      claims: [],
    });
  });

  it("opens a same-file duplicate as read-only when another instance already views it", () => {
    enableRailMode();
    addWorkspaceInstance("main", "wsi-main", "/repo");
    addWorkspaceInstance("doc-1", "wsi-doc", "/repo");
    addTab("main", "tab-a", "/repo/notes.md");
    addTab("doc-1", "tab-b", "/repo/notes.md");

    expect(resolveFileOpenOwnership("/repo/notes.md", { currentTabId: "tab-b" })).toMatchObject({
      mode: "readonlyDuplicate",
      claims: [{ tabId: "tab-a", workspaceInstanceId: "wsi-main" }],
    });
    applyFileOwnershipAfterOpen("tab-b", "/repo/notes.md");
    expect(useDocumentStore.getState().getDocument("tab-b")?.readOnly).toBe(true);
  });

  it("reports dirty writable conflicts across workspace instances", () => {
    enableRailMode();
    addWorkspaceInstance("main", "wsi-main", "/repo");
    addWorkspaceInstance("doc-1", "wsi-doc", "/repo");
    addTab("main", "tab-a", "/repo/notes.md", { dirty: true });
    addTab("doc-1", "tab-b", "/repo/notes.md");

    expect(resolveFileOpenOwnership("/repo/notes.md", { currentTabId: "tab-b" })).toMatchObject({
      mode: "readonlyConflict",
    });
    expect(resolveWritableFileOwnership("tab-b", "/repo/notes.md")).toMatchObject({
      ok: false,
      reason: "dirtyWritableConflict",
      conflicts: [{ tabId: "tab-a", workspaceInstanceId: "wsi-main" }],
    });
  });

  it("does not treat a read-only dirty duplicate as a writable conflict", () => {
    enableRailMode();
    addWorkspaceInstance("main", "wsi-main", "/repo");
    addWorkspaceInstance("doc-1", "wsi-doc", "/repo");
    addTab("main", "tab-a", "/repo/notes.md", { dirty: true, readOnly: true });
    addTab("doc-1", "tab-b", "/repo/notes.md");

    expect(resolveWritableFileOwnership("tab-b", "/repo/notes.md")).toMatchObject({
      ok: true,
      mode: "writable",
    });
  });

  it("supports explicit forced writable takeover", () => {
    enableRailMode();
    addWorkspaceInstance("main", "wsi-main", "/repo");
    addWorkspaceInstance("doc-1", "wsi-doc", "/repo");
    addTab("main", "tab-a", "/repo/notes.md", { dirty: true });
    addTab("doc-1", "tab-b", "/repo/notes.md");

    expect(resolveWritableFileOwnership("tab-b", "/repo/notes.md", { force: true })).toMatchObject({
      ok: true,
      mode: "forced",
      conflicts: [{ tabId: "tab-a" }],
    });
  });

  it("blocks read-only unlock when another dirty writable instance owns the file", () => {
    enableRailMode();
    addWorkspaceInstance("main", "wsi-main", "/repo");
    addWorkspaceInstance("doc-1", "wsi-doc", "/repo");
    addTab("main", "tab-a", "/repo/notes.md", { dirty: true });
    addTab("doc-1", "tab-b", "/repo/notes.md", { readOnly: true });

    expect(toggleDocumentReadOnlyWithOwnership("tab-b")).toBe(false);
    expect(useDocumentStore.getState().getDocument("tab-b")?.readOnly).toBe(true);
    expect(mockToastError).toHaveBeenCalledWith(
      "dialog:toast.sameFileDirtyConflict",
      { pin: true },
    );
  });

  it("allows forced read-only unlock for explicit takeover flows", () => {
    enableRailMode();
    addTab("main", "tab-a", "/repo/notes.md", { dirty: true });
    addTab("doc-1", "tab-b", "/repo/notes.md", { readOnly: true });

    expect(setDocumentReadOnlyWithOwnership("tab-b", false, { force: true })).toBe(true);
    expect(useDocumentStore.getState().getDocument("tab-b")?.readOnly).toBe(false);
  });

  it("matches Windows case variants by platform identity", () => {
    enableRailMode();
    addTab("main", "tab-a", "C:\\Repo\\Notes.md", { dirty: true });
    addTab("doc-1", "tab-b", "c:\\repo\\notes.md");

    expect(
      resolveWritableFileOwnership("tab-b", "c:\\repo\\notes.md", { platform: "windows" }),
    ).toMatchObject({ ok: false });
  });

  it("matches macOS case variants of the same file (case-insensitive volume)", () => {
    enableRailMode();
    addTab("main", "tab-a", "/Repo/Notes.md", { dirty: true });
    addTab("doc-1", "tab-b", "/repo/notes.md");

    // Default macOS volumes are case-insensitive: opening "/repo/notes.md"
    // while "/Repo/Notes.md" is dirty-writable must be detected as a conflict.
    expect(
      resolveWritableFileOwnership("tab-b", "/repo/notes.md", { platform: "macos" }),
    ).toMatchObject({ ok: false, reason: "dirtyWritableConflict" });
  });

  it("keeps Linux case variants distinct (case-sensitive volume)", () => {
    enableRailMode();
    addTab("main", "tab-a", "/Repo/Notes.md", { dirty: true });
    addTab("doc-1", "tab-b", "/repo/notes.md");

    expect(
      resolveWritableFileOwnership("tab-b", "/repo/notes.md", { platform: "linux" }),
    ).toMatchObject({ ok: true });
  });

  it("matches symlink aliases when canonical paths are supplied", () => {
    enableRailMode();
    addTab("main", "tab-a", "/repo/alias/notes.md", { dirty: true });
    addTab("doc-1", "tab-b", "/real/repo/notes.md");

    expect(
      resolveWritableFileOwnership("tab-b", "/real/repo/notes.md", {
        canonicalPath: "/real/repo/notes.md",
        canonicalPaths: { "/repo/alias/notes.md": "/real/repo/notes.md" },
      }),
    ).toMatchObject({ ok: false });
  });

  it("does not apply the target canonical path to unrelated open files", () => {
    enableRailMode();
    addTab("main", "tab-a", "/other/file.md", { dirty: true });
    addTab("doc-1", "tab-b", "/real/repo/notes.md");

    expect(
      resolveWritableFileOwnership("tab-b", "/real/repo/notes.md", {
        canonicalPath: "/real/repo/notes.md",
      }),
    ).toMatchObject({ ok: true });
  });
});
