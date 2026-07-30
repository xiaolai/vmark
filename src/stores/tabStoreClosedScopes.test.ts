// WI-11.1 — scoped closed-tab history (plan D4): full ClosedTabEntry metadata
// per scopeKey (workspace instance id, browser-global, or window-all when the
// rail is off), monotonic close sequence, one cap policy per scope. Replaces
// the old flat closedTabs pool.
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { BROWSER_SCOPE } from "@/services/workspaces/workspaceOwnershipKernel";
import { notifyTabRemoved } from "./tabRemovalBus";
import type { Tab } from "./tabStore";
import {
  WINDOW_ALL_SCOPE,
  useClosedTabScopesStore,
} from "./tabStoreClosedScopes";

function doc(id: string, filePath: string | null): Tab {
  return { id, kind: "document", title: id, filePath, isPinned: false } as Tab;
}

function browserTab(id: string): Tab {
  return { id, kind: "browser", title: id, isPinned: false } as unknown as Tab;
}

function setRail(enabled: boolean): void {
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: enabled },
  });
}

function addWorkspace(id: string, rootPath: string): void {
  const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
  if (!root.ok) throw new Error("bad test root");
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(
    createWorkspaceInstance({
      workspaceInstanceId: id,
      root: root.root,
      ownerWindowLabel: "main",
      createdFrom: "open",
    }),
  );
}

beforeEach(() => {
  useClosedTabScopesStore.getState().resetClosedScopes();
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  setRail(false);
});

describe("tabStoreClosedScopes (WI-11.1)", () => {
  it("rail off: closed documents land in the window-all scope", () => {
    useClosedTabScopesStore.getState().recordClosedTab("main", doc("t-1", "/a.md"));

    expect(
      useClosedTabScopesStore.getState().closedIdsForScope("main", WINDOW_ALL_SCOPE),
    ).toEqual(["t-1"]);
  });

  it("rail on: closed documents land in their owning instance's scope", () => {
    setRail(true);
    addWorkspace("wsi-a", "/repo-a");
    addWorkspace("wsi-b", "/repo-b");

    useClosedTabScopesStore.getState().recordClosedTab("main", doc("t-a", "/repo-a/x.md"));
    useClosedTabScopesStore.getState().recordClosedTab("main", doc("t-b", "/repo-b/y.md"));

    expect(useClosedTabScopesStore.getState().closedIdsForScope("main", "wsi-a")).toEqual(["t-a"]);
    expect(useClosedTabScopesStore.getState().closedIdsForScope("main", "wsi-b")).toEqual(["t-b"]);
  });

  it("browser tabs land in the window-global browser scope, rail on or off", () => {
    useClosedTabScopesStore.getState().recordClosedTab("main", browserTab("t-web"));
    expect(
      useClosedTabScopesStore.getState().closedIdsForScope("main", BROWSER_SCOPE),
    ).toEqual(["t-web"]);
  });

  it("rail on, unowned doc with an active instance falls back to that instance's scope", () => {
    setRail(true);
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-a");
    // Out-of-root doc, NO loose instance → owner undefined → active fallback.
    useClosedTabScopesStore.getState().recordClosedTab("main", doc("t-out", "/elsewhere/x.md"));
    expect(useClosedTabScopesStore.getState().closedIdsForScope("main", "wsi-a")).toEqual(["t-out"]);
  });

  it("rail on with NO instances at all falls back to the window-all scope", () => {
    setRail(true);
    useClosedTabScopesStore.getState().recordClosedTab("main", doc("t-x", "/repo-a/x.md"));
    expect(
      useClosedTabScopesStore.getState().closedIdsForScope("main", WINDOW_ALL_SCOPE),
    ).toEqual(["t-x"]);
  });

  it("caps each scope at 10, evicting the oldest", () => {
    for (let i = 0; i < 12; i++) {
      useClosedTabScopesStore.getState().recordClosedTab("main", doc(`t-${i}`, `/f${i}.md`));
    }
    const ids = useClosedTabScopesStore.getState().closedIdsForScope("main", WINDOW_ALL_SCOPE);
    expect(ids).toHaveLength(10);
    expect(ids[0]).toBe("t-11"); // newest first
    expect(ids).not.toContain("t-0");
    expect(ids).not.toContain("t-1");
  });

  it("caps are independent per scope (inactive workspaces don't evict each other)", () => {
    setRail(true);
    addWorkspace("wsi-a", "/repo-a");
    addWorkspace("wsi-b", "/repo-b");
    for (let i = 0; i < 10; i++) {
      useClosedTabScopesStore.getState().recordClosedTab("main", doc(`a-${i}`, `/repo-a/${i}.md`));
    }
    useClosedTabScopesStore.getState().recordClosedTab("main", doc("b-0", "/repo-b/z.md"));

    expect(useClosedTabScopesStore.getState().closedIdsForScope("main", "wsi-a")).toHaveLength(10);
    expect(useClosedTabScopesStore.getState().closedIdsForScope("main", "wsi-b")).toEqual(["b-0"]);
  });

  it("newestEntry compares across scopes by close sequence", () => {
    setRail(true);
    addWorkspace("wsi-a", "/repo-a");
    useClosedTabScopesStore.getState().recordClosedTab("main", doc("t-a", "/repo-a/x.md"));
    useClosedTabScopesStore.getState().recordClosedTab("main", browserTab("t-web"));

    const newest = useClosedTabScopesStore
      .getState()
      .newestEntry("main", ["wsi-a", BROWSER_SCOPE]);
    expect(newest?.entry.tab.id).toBe("t-web");
    expect(newest?.scopeKey).toBe(BROWSER_SCOPE);
  });

  it("takeClosedTab removes and returns the entry", () => {
    useClosedTabScopesStore.getState().recordClosedTab("main", doc("t-1", "/a.md"));

    const taken = useClosedTabScopesStore
      .getState()
      .takeClosedTab("main", WINDOW_ALL_SCOPE, "t-1");
    expect(taken?.id).toBe("t-1");
    expect(
      useClosedTabScopesStore.getState().closedIdsForScope("main", WINDOW_ALL_SCOPE),
    ).toEqual([]);
    expect(
      useClosedTabScopesStore.getState().takeClosedTab("main", WINDOW_ALL_SCOPE, "t-1"),
    ).toBeNull();
  });

  it("is fed by the removal bus on close but NOT on detach", () => {
    notifyTabRemoved("main", "t-closed", { tab: doc("t-closed", "/a.md"), reason: "close" });
    notifyTabRemoved("main", "t-detached", { tab: doc("t-detached", "/b.md"), reason: "detach" });

    const ids = useClosedTabScopesStore.getState().closedIdsForScope("main", WINDOW_ALL_SCOPE);
    expect(ids).toEqual(["t-closed"]);
  });

  it("removeWindowClosedScopes drops all scopes of a window", () => {
    useClosedTabScopesStore.getState().recordClosedTab("main", doc("t-1", "/a.md"));
    useClosedTabScopesStore.getState().recordClosedTab("doc-1", doc("t-2", "/b.md"));

    useClosedTabScopesStore.getState().removeWindowClosedScopes("main");

    expect(
      useClosedTabScopesStore.getState().closedIdsForScope("main", WINDOW_ALL_SCOPE),
    ).toEqual([]);
    expect(
      useClosedTabScopesStore.getState().closedIdsForScope("doc-1", WINDOW_ALL_SCOPE),
    ).toEqual(["t-2"]);
  });
});

// R2-F13/F14/F15 — hydrate hardening: hot-exit payloads are UNTRUSTED. Browser
// entries must carry a canonical http(s) URL and live only in the browser
// scope; documents never hydrate there; one scope per id; hydration REPLACES.
describe("hydrateWindowClosedScopes hardening (R2-F13/F14/F15)", () => {
  const hydrate = (scopes: Record<string, unknown>) =>
    useClosedTabScopesStore.getState().hydrateWindowClosedScopes("main", scopes);
  const ids = (scope: string) =>
    useClosedTabScopesStore.getState().closedIdsForScope("main", scope);
  const docEntry = (id: string, seq: number) => ({
    tab: { id, kind: "document", title: id, filePath: `/x/${id}.md`, isPinned: false },
    closedSeq: seq,
  });
  const webEntry = (id: string, url: string, seq: number) => ({
    tab: { id, kind: "browser", title: id, url, isPinned: false },
    closedSeq: seq,
  });

  it("drops browser entries whose URL is not canonical http(s)", () => {
    hydrate({
      [BROWSER_SCOPE]: [
        webEntry("t-evil", "javascript:alert(1)", 1),
        webEntry("t-file", "file:///etc/passwd", 2),
        webEntry("t-ok", "https://ok.example/", 3),
      ],
    });
    expect(ids(BROWSER_SCOPE)).toEqual(["t-ok"]);
  });

  it("enforces kind-scope coherence both directions", () => {
    hydrate({
      "wsi-a": [webEntry("t-web-wrong", "https://ok.example/", 1), docEntry("t-doc", 2)],
      [BROWSER_SCOPE]: [docEntry("t-doc-wrong", 3)],
    });
    expect(ids("wsi-a")).toEqual(["t-doc"]);
    expect(ids(BROWSER_SCOPE)).toEqual([]);
  });

  it("keeps one scope per tab id across the payload (first scope wins)", () => {
    hydrate({
      "wsi-a": [docEntry("t-dup", 1)],
      "wsi-b": [docEntry("t-dup", 2), docEntry("t-solo", 3)],
    });
    expect(ids("wsi-a")).toEqual(["t-dup"]);
    expect(ids("wsi-b")).toEqual(["t-solo"]);
  });

  it("an empty or wholly-invalid payload CLEARS prior scopes (hydration replaces)", () => {
    useClosedTabScopesStore.getState().recordClosedTab("main", doc("t-old", "/a.md"));
    expect(ids(WINDOW_ALL_SCOPE)).toEqual(["t-old"]);

    hydrate({ [WINDOW_ALL_SCOPE]: [{ nonsense: true }] });

    expect(ids(WINDOW_ALL_SCOPE)).toEqual([]);
  });
});
