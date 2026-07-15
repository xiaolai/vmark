import { beforeEach, describe, expect, it } from "vitest";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore, type Tab } from "@/stores/tabStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import type { WorkspaceTransferTabPayload, WorkspaceWindowOperation } from "@/types/workspaceTransfer";
import {
  classifyDuplicateEligibility,
  collectWorkspaceTabs,
  resolveTransferActiveTab,
  serializeTransferTab,
} from "./workspaceTabCollection";

function tab(over: Partial<Tab> = {}): Tab {
  return { id: "t1", filePath: "/a.md", title: "a", isPinned: false, formatId: "markdown", ...over };
}

type Doc = Parameters<typeof serializeTransferTab>[1];
function doc(over: Partial<Doc> = {}): Doc {
  return {
    content: "c",
    savedContent: "c",
    isDirty: false,
    readOnly: false,
    isMissing: false,
    ...over,
  } as Doc;
}

describe("classifyDuplicateEligibility", () => {
  it("never skips for a move", () => {
    expect(classifyDuplicateEligibility(tab({ filePath: null }), doc({ isDirty: true }), "move")).toBeNull();
  });

  it.each<[Partial<Tab>, Partial<Doc>, string]>([
    [{ filePath: null }, {}, "untitled"],
    [{}, { isMissing: true }, "missing"],
    [{}, { isDirty: true }, "dirty"],
  ])("skips %j/%j as %s on duplicate", (tabOver, docOver, expected) => {
    expect(classifyDuplicateEligibility(tab(tabOver), doc(docOver), "duplicate" as WorkspaceWindowOperation))
      .toBe(expected);
  });

  it("is eligible when clean, present, and titled on duplicate", () => {
    expect(classifyDuplicateEligibility(tab(), doc(), "duplicate")).toBeNull();
  });
});

describe("resolveTransferActiveTab", () => {
  const tabs: WorkspaceTransferTabPayload[] = [
    { tabId: "a" } as WorkspaceTransferTabPayload,
    { tabId: "b" } as WorkspaceTransferTabPayload,
  ];

  it("keeps the window's active tab when it was collected", () => {
    expect(resolveTransferActiveTab(tabs, "b")).toBe("b");
  });

  it("falls back to the first collected tab when the active tab was not collected", () => {
    expect(resolveTransferActiveTab(tabs, "z")).toBe("a");
  });

  it("returns null for an empty collection", () => {
    expect(resolveTransferActiveTab([], "a")).toBeNull();
  });
});

describe("serializeTransferTab", () => {
  it("copies tab + document fields into the transfer payload", () => {
    const result = serializeTransferTab(
      tab({ id: "x", title: "X", filePath: "/x.md", isPinned: true }),
      doc({ content: "edited", savedContent: "saved", isDirty: true, readOnly: true }),
    );
    expect(result).toMatchObject({
      tabId: "x",
      title: "X",
      filePath: "/x.md",
      content: "edited",
      savedContent: "saved",
      isDirty: true,
      readOnly: true,
      isPinned: true,
    });
  });
});

const WINDOW = "main";

function addWorkspaceInstance(id: string, rootPath: string) {
  const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
  if (!root.ok) throw new Error("fixture root should be valid");
  const instance = createWorkspaceInstance({
    workspaceInstanceId: id,
    root: root.root,
    ownerWindowLabel: WINDOW,
    createdFrom: "open",
  });
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(instance);
  return useWorkspaceInstancesStore.getState().instances[id];
}

function instanceOf(id: string) {
  const instance = useWorkspaceInstancesStore.getState().instances[id];
  if (!instance) throw new Error(`missing instance ${id}`);
  return instance;
}

function addDocumentTab(filePath: string | null, content = "c"): string {
  const tabId = useTabStore.getState().createTab(WINDOW, filePath);
  useDocumentStore.getState().initDocument(tabId, content, filePath, content);
  return tabId;
}

describe("collectWorkspaceTabs", () => {
  beforeEach(() => {
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
    useTabStore.setState({ tabs: {}, activeTabId: {}, closedTabs: {}, untitledCounter: 0 });
    useDocumentStore.setState({ documents: {} });
  });

  it("collects the tabs whose path classifies into the instance", () => {
    addWorkspaceInstance("ws-a", "/a");
    addWorkspaceInstance("ws-b", "/b");
    const inA = addDocumentTab("/a/one.md");
    addDocumentTab("/b/two.md");

    const collected = collectWorkspaceTabs(WINDOW, instanceOf("ws-a"), "move");

    expect(collected.tabs.map((t) => t.tabId)).toEqual([inA]);
    expect(collected.activeTabId).toBe(inA);
  });

  it("leaves a tab that another instance explicitly owns to that instance", () => {
    addWorkspaceInstance("ws-a", "/a");
    addWorkspaceInstance("ws-b", "/b");
    // The tab lives under /b's root, but was explicitly claimed by ws-a (e.g.
    // it was opened before /b became a workspace instance in this window).
    const tabId = addDocumentTab("/b/shared.md");
    useWorkspaceInstancesStore.getState().setWorkspaceInstanceTabs("ws-a", [tabId], tabId, []);

    const fromB = collectWorkspaceTabs(WINDOW, instanceOf("ws-b"), "move");
    const fromA = collectWorkspaceTabs(WINDOW, instanceOf("ws-a"), "move");

    // Exclusive ownership: only the explicit owner may move/duplicate the tab.
    expect(fromB.tabs).toEqual([]);
    expect(fromA.tabs.map((t) => t.tabId)).toEqual([tabId]);
  });

  it("excludes browser tabs (R1: no document content to transfer)", () => {
    addWorkspaceInstance("ws-a", "/a");
    const docTab = addDocumentTab("/a/one.md");
    useTabStore.getState().createBrowserTab(WINDOW, "https://example.com");

    const collected = collectWorkspaceTabs(WINDOW, instanceOf("ws-a"), "move");

    expect(collected.tabs.map((t) => t.tabId)).toEqual([docTab]);
    // The active tab is the browser tab (createBrowserTab activates it), which
    // is not transferable — fall back to the first collected document tab.
    expect(collected.activeTabId).toBe(docTab);
  });

  it("counts skipped tabs by reason on duplicate", () => {
    addWorkspaceInstance("ws-a", "/a");
    const clean = addDocumentTab("/a/clean.md");
    const dirty = addDocumentTab("/a/dirty.md");
    useDocumentStore.getState().setContent(dirty, "changed");
    const missing = addDocumentTab("/a/missing.md");
    useDocumentStore.getState().markMissing(missing);
    addDocumentTab(null); // untitled → classified into the active instance

    const collected = collectWorkspaceTabs(WINDOW, instanceOf("ws-a"), "duplicate");

    expect(collected.tabs.map((t) => t.tabId)).toEqual([clean]);
    expect(collected.skippedDirtyCount).toBe(1);
    expect(collected.skippedMissingCount).toBe(1);
  });
});
