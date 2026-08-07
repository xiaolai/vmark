// @vitest-environment node
// WI-1R — pure ownership kernel: one partition rule shared by visibility,
// stash, close, move/duplicate, hot-exit capture, and session persistence.
import { describe, expect, it } from "vitest";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import {
  BROWSER_SCOPE,
  contextKindOf,
  partitionWindowTabs,
  resolveIncomingActiveTab,
  visibleTabsForWindow,
  type KernelTab,
} from "./workspaceOwnershipKernel";

function workspace(id: string, rootPath: string, tabIds: string[] = []) {
  const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
  if (!root.ok) throw new Error("invalid test root");
  const instance = createWorkspaceInstance({
    workspaceInstanceId: id,
    root: root.root,
    ownerWindowLabel: "main",
    createdFrom: "open",
  });
  return { ...instance, tabIds };
}

function loose(id = "wsi-loose", tabIds: string[] = []) {
  const instance = createWorkspaceInstance({
    workspaceInstanceId: id,
    root: null,
    ownerWindowLabel: "main",
    createdFrom: "open",
    kind: "loose",
  });
  return { ...instance, tabIds };
}

function doc(id: string, filePath: string | null): KernelTab {
  return { id, kind: "document", filePath };
}

function browser(id: string): KernelTab {
  return { id, kind: "browser" };
}

const TABS: KernelTab[] = [
  doc("t-a1", "/repo-a/one.md"),
  doc("t-a2", "/repo-a/two.md"),
  doc("t-b1", "/repo-b/one.md"),
  doc("t-out", "/elsewhere/x.md"),
  browser("t-web"),
];

describe("partitionWindowTabs", () => {
  it("assigns each tab exactly one scope (exclusivity invariant)", () => {
    const instances = [workspace("wsi-a", "/repo-a"), workspace("wsi-b", "/repo-b"), loose()];
    const partition = partitionWindowTabs(TABS, instances, "wsi-a");

    const allAssigned = [...partition.byScope.values()].flat();
    expect(new Set(allAssigned).size).toBe(allAssigned.length);
    expect(allAssigned.sort()).toEqual(TABS.map((t) => t.id).sort());
  });

  it("browser tabs always go to the window-global browser scope", () => {
    const instances = [workspace("wsi-a", "/repo-a"), loose()];
    const partition = partitionWindowTabs(TABS, instances, "wsi-a");

    expect(partition.byScope.get(BROWSER_SCOPE)).toEqual(["t-web"]);
    expect(partition.ownerOf.get("t-web")).toBe(BROWSER_SCOPE);
  });

  it("explicit claim wins over path classification, across ALL instances", () => {
    // t-a1 lives under /repo-a by path but instance B claims it explicitly.
    const instances = [
      workspace("wsi-a", "/repo-a"),
      workspace("wsi-b", "/repo-b", ["t-a1"]),
      loose(),
    ];
    const partition = partitionWindowTabs(TABS, instances, "wsi-a");

    expect(partition.ownerOf.get("t-a1")).toBe("wsi-b");
    expect(partition.byScope.get("wsi-a")).toEqual(["t-a2"]);
  });

  it("corrupt duplicate claims resolve to the first claimant in rail order", () => {
    const instances = [
      workspace("wsi-a", "/repo-a", ["t-out"]),
      workspace("wsi-b", "/repo-b", ["t-out"]),
      loose(),
    ];
    const partition = partitionWindowTabs(TABS, instances, "wsi-b");

    expect(partition.ownerOf.get("t-out")).toBe("wsi-a");
    expect(partition.byScope.get("wsi-b")).toEqual(["t-b1"]);
  });

  it("unclaimed out-of-root documents classify to the loose instance", () => {
    const instances = [workspace("wsi-a", "/repo-a"), loose()];
    const partition = partitionWindowTabs(TABS, instances, "wsi-a");

    expect(partition.ownerOf.get("t-out")).toBe("wsi-loose");
    expect(partition.ownerOf.get("t-b1")).toBe("wsi-loose");
  });

  it("nested roots: the most specific root owns the file", () => {
    const instances = [
      workspace("wsi-root", "/repo-a"),
      workspace("wsi-nested", "/repo-a/one.md".replace("/one.md", "") + "/nested"),
      loose(),
    ];
    const tabs = [doc("t-deep", "/repo-a/nested/deep.md")];
    const partition = partitionWindowTabs(tabs, instances, "wsi-root");

    expect(partition.ownerOf.get("t-deep")).toBe("wsi-nested");
  });

  it("duplicate ids in instance.tabIds do not duplicate the partition output", () => {
    const instances = [workspace("wsi-a", "/repo-a", ["t-a1", "t-a1"]), loose()];
    const partition = partitionWindowTabs([doc("t-a1", "/repo-a/one.md")], instances, "wsi-a");

    expect(partition.byScope.get("wsi-a")).toEqual(["t-a1"]);
  });

  it("a document with no owner (no loose instance) stays unowned", () => {
    const instances = [workspace("wsi-a", "/repo-a")];
    const partition = partitionWindowTabs([doc("t-out", "/elsewhere/x.md")], instances, "wsi-a");

    expect(partition.ownerOf.has("t-out")).toBe(false);
  });

  it("is deterministic: same inputs produce identical partitions", () => {
    const instances = [workspace("wsi-a", "/repo-a"), workspace("wsi-b", "/repo-b"), loose()];
    const p1 = partitionWindowTabs(TABS, instances, "wsi-a");
    const p2 = partitionWindowTabs(TABS, instances, "wsi-a");

    expect([...p1.byScope.entries()]).toEqual([...p2.byScope.entries()]);
    expect([...p1.ownerOf.entries()]).toEqual([...p2.ownerOf.entries()]);
  });
});

describe("visibleTabsForWindow", () => {
  const instances = [workspace("wsi-a", "/repo-a"), workspace("wsi-b", "/repo-b"), loose()];

  it("rail disabled: returns the input tabs unchanged (order and members)", () => {
    const visible = visibleTabsForWindow(TABS, instances, "wsi-a", false);
    expect(visible.map((t) => t.id)).toEqual(TABS.map((t) => t.id));
  });

  it("rail enabled: active-instance documents plus ALL browser tabs", () => {
    const visible = visibleTabsForWindow(TABS, instances, "wsi-a", true);
    expect(visible.map((t) => t.id)).toEqual(["t-a1", "t-a2", "t-web"]);
  });

  it("loose active: loose documents plus browser tabs", () => {
    const visible = visibleTabsForWindow(TABS, instances, "wsi-loose", true);
    expect(visible.map((t) => t.id)).toEqual(["t-out", "t-web"]);
  });

  it("a tab explicitly claimed by B is never visible under A", () => {
    const claimed = [
      workspace("wsi-a", "/repo-a"),
      workspace("wsi-b", "/repo-b", ["t-a1"]),
      loose(),
    ];
    const visible = visibleTabsForWindow(TABS, claimed, "wsi-a", true);
    expect(visible.map((t) => t.id)).toEqual(["t-a2", "t-web"]);
  });

  it("an unowned document (no loose instance) is visible under every instance", () => {
    const noLoose = [workspace("wsi-a", "/repo-a"), workspace("wsi-b", "/repo-b")];
    const tabs = [doc("t-out", "/elsewhere/x.md"), doc("t-a1", "/repo-a/one.md")];

    expect(visibleTabsForWindow(tabs, noLoose, "wsi-a", true).map((t) => t.id))
      .toEqual(["t-out", "t-a1"]);
    expect(visibleTabsForWindow(tabs, noLoose, "wsi-b", true).map((t) => t.id))
      .toEqual(["t-out"]);
  });

  it("zero owned tabs yields only browser tabs (empty editor is legal)", () => {
    const empty = [workspace("wsi-c", "/repo-c"), ...instances];
    const visible = visibleTabsForWindow(TABS, empty, "wsi-c", true);
    expect(visible.map((t) => t.id)).toEqual(["t-web"]);
  });
});

describe("resolveIncomingActiveTab", () => {
  const instances = [workspace("wsi-a", "/repo-a"), workspace("wsi-b", "/repo-b"), loose()];

  it("returns the recorded activeTabId when it is live and owned", () => {
    const a = { ...instances[0], activeTabId: "t-a2" };
    expect(resolveIncomingActiveTab(a, TABS, [a, ...instances.slice(1)])).toBe("t-a2");
  });

  it("falls back to the first owned tab (full window tab order) when stale", () => {
    const a = { ...instances[0], activeTabId: "t-gone" };
    expect(resolveIncomingActiveTab(a, TABS, [a, ...instances.slice(1)])).toBe("t-a1");
  });

  it("never returns a tab owned by another instance", () => {
    // Recorded id exists live but is claimed by B.
    const b = { ...instances[1], tabIds: ["t-a1"] };
    const a = { ...instances[0], activeTabId: "t-a1" };
    expect(resolveIncomingActiveTab(a, TABS, [a, b, instances[2]])).toBe("t-a2");
  });

  it("returns null when the instance owns nothing", () => {
    const c = workspace("wsi-c", "/repo-c");
    expect(resolveIncomingActiveTab(c, TABS, [c, ...instances])).toBeNull();
  });

  it("never resolves to a browser tab", () => {
    const l = { ...loose(), activeTabId: "t-web" };
    const onlyBrowser = [browser("t-web")];
    expect(resolveIncomingActiveTab(l, onlyBrowser, [l])).toBeNull();
  });
});

describe("contextKindOf (legacy-record fallbacks)", () => {
  it("resolves explicit kind, root-derived workspace, placeholder, and loose", () => {
    const base = loose("wsi-x");
    expect(contextKindOf({ ...base, kind: "workspace" })).toBe("workspace");
    expect(contextKindOf({ ...base, kind: undefined as never, rootPath: "/r" })).toBe("workspace");
    expect(
      contextKindOf({ ...base, kind: undefined as never, rootPath: null, createdFrom: "placeholder" }),
    ).toBe("placeholder");
    expect(
      contextKindOf({ ...base, kind: undefined as never, rootPath: null, createdFrom: "open" }),
    ).toBe("loose");
  });
});
