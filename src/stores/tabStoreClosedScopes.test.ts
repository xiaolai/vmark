// @vitest-environment node
// WI-11.1 — scoped closed-tab history (plan D4): full ClosedTabEntry metadata
// per scopeKey (workspace instance id, browser-global, or window-all when the
// rail is off), monotonic close sequence, one cap policy per scope. Replaces
// the old flat closedTabs pool.
// WI-TS2.3 — removeClosedScope: per-instance history cleanup on close/move.
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
  // Complete DocumentTab shape (R3-6): hydration validates the FULL required
  // shape now, so a fixture missing formatId would test nothing but its own
  // incompleteness.
  return {
    id,
    kind: "document",
    title: id,
    filePath,
    isPinned: false,
    formatId: "markdown",
  } as Tab;
}

function browserTab(id: string): Tab {
  // Complete BrowserTab shape (R3-6).
  return {
    id,
    kind: "browser",
    title: id,
    isPinned: false,
    url: "https://ok.example/",
    automationMode: "human",
    persistPolicy: "restore-human",
  } as unknown as Tab;
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
    tab: {
      id,
      kind: "document",
      title: id,
      filePath: `/x/${id}.md`,
      isPinned: false,
      formatId: "markdown",
    },
    closedSeq: seq,
  });
  const webEntry = (id: string, url: string, seq: number) => ({
    tab: {
      id,
      kind: "browser",
      title: id,
      url,
      isPinned: false,
      automationMode: "human",
      persistPolicy: "restore-human",
    },
    closedSeq: seq,
  });
  // Hydration whitelists scope keys to THIS window's instances (R3-4), so
  // every test that hydrates into wsi-a/wsi-b must actually have them.
  beforeEach(() => {
    addWorkspace("wsi-a", "/repo-a");
    addWorkspace("wsi-b", "/repo-b");
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

  it("drops non-object entries and unknown tab kinds", () => {
    hydrate({
      "wsi-a": [
        "garbage",
        { tab: { id: "t-weird", kind: "weird" }, closedSeq: 1 },
        docEntry("t-ok", 2),
      ],
    });
    expect(ids("wsi-a")).toEqual(["t-ok"]);
  });

  it("skips scope values that are not arrays, keeping valid siblings", () => {
    hydrate({ "wsi-a": { not: "an array" }, "wsi-b": [docEntry("t-b", 1)] });
    expect(ids("wsi-a")).toEqual([]);
    expect(ids("wsi-b")).toEqual(["t-b"]);
  });
});

describe("closed-scope guards on unknown state", () => {
  it("takeClosedTab from an unknown window returns null", () => {
    expect(
      useClosedTabScopesStore.getState().takeClosedTab("ghost", WINDOW_ALL_SCOPE, "t-x"),
    ).toBeNull();
  });

  it("removeWindowClosedScopes on an unknown window is a no-op", () => {
    const before = useClosedTabScopesStore.getState().scopesByWindow;
    useClosedTabScopesStore.getState().removeWindowClosedScopes("ghost");
    expect(useClosedTabScopesStore.getState().scopesByWindow).toBe(before);
  });

  it("tolerates a partial settings store — closes land in window-all", () => {
    const saved = useSettingsStore.getState().general;
    useSettingsStore.setState({ general: undefined as never });
    try {
      useClosedTabScopesStore.getState().recordClosedTab("main", doc("t-ps", "/a.md"));
      expect(
        useClosedTabScopesStore.getState().closedIdsForScope("main", WINDOW_ALL_SCOPE),
      ).toEqual(["t-ps"]);
    } finally {
      useSettingsStore.setState({ general: saved });
    }
  });
});

describe("removeClosedScope (WI-TS2.3)", () => {
  it("drops exactly one scope's history, leaving siblings intact", () => {
    setRail(true);
    addWorkspace("wsi-a", "/repo-a");
    addWorkspace("wsi-b", "/repo-b");
    useClosedTabScopesStore.getState().recordClosedTab("main", doc("t-a", "/repo-a/x.md"));
    useClosedTabScopesStore.getState().recordClosedTab("main", doc("t-b", "/repo-b/y.md"));

    useClosedTabScopesStore.getState().removeClosedScope("main", "wsi-a");

    expect(
      useClosedTabScopesStore.getState().closedIdsForScope("main", "wsi-a"),
    ).toEqual([]);
    expect(
      useClosedTabScopesStore.getState().closedIdsForScope("main", "wsi-b"),
    ).toEqual(["t-b"]);
  });

  it("is a no-op for an unknown scope or window (no store wake)", () => {
    const before = useClosedTabScopesStore.getState().scopesByWindow;
    useClosedTabScopesStore.getState().removeClosedScope("main", "wsi-ghost");
    useClosedTabScopesStore.getState().removeClosedScope("nowhere", "wsi-a");
    expect(useClosedTabScopesStore.getState().scopesByWindow).toBe(before);
  });
});

describe("rekeyClosedScope (audit 20260831 #9)", () => {
  it("carries a loose instance's reopen history through an identity re-key", () => {
    setRail(true);
    addWorkspace("wsi-a", "/repo-a");
    useClosedTabScopesStore.getState().recordClosedTab("main", doc("t-a", "/repo-a/x.md"));

    useClosedTabScopesStore.getState().rekeyClosedScope("main", "wsi-a", "wsi-renamed");

    expect(useClosedTabScopesStore.getState().closedIdsForScope("main", "wsi-a")).toEqual([]);
    expect(
      useClosedTabScopesStore.getState().closedIdsForScope("main", "wsi-renamed"),
    ).toEqual(["t-a"]);
  });

  it("merges into an existing target newest-first and keeps the cap", () => {
    // Hydration whitelists scope keys to real window instances (R3-4).
    addWorkspace("wsi-old", "/repo-old");
    addWorkspace("wsi-new", "/repo-new");
    useClosedTabScopesStore.getState().hydrateWindowClosedScopes("main", {
      "wsi-old": [{ tab: doc("t-1", "/a.md"), closedSeq: 5 }],
      "wsi-new": [{ tab: doc("t-2", "/b.md"), closedSeq: 9 }],
    });

    useClosedTabScopesStore.getState().rekeyClosedScope("main", "wsi-old", "wsi-new");

    expect(
      useClosedTabScopesStore.getState().closedIdsForScope("main", "wsi-new"),
    ).toEqual(["t-2", "t-1"]);
  });

  it("fires through the instances store's loose-instance re-key (bus wiring)", () => {
    setRail(true);
    useWorkspaceInstancesStore.getState().ensureLooseInstance("main");
    const looseId = useWorkspaceInstancesStore
      .getState()
      .windows["main"]!.workspaceInstanceIds.find((id) =>
        useWorkspaceInstancesStore.getState().instances[id]?.kind === "loose",
      )!;
    useClosedTabScopesStore.getState().hydrateWindowClosedScopes("main", {
      [looseId]: [{ tab: doc("t-l", "/loose.md"), closedSeq: 3 }],
    });

    useWorkspaceInstancesStore.getState().ensureLooseInstance("main", "wsi-loose-renamed");

    expect(
      useClosedTabScopesStore.getState().closedIdsForScope("main", "wsi-loose-renamed"),
    ).toEqual(["t-l"]);
    expect(useClosedTabScopesStore.getState().closedIdsForScope("main", looseId)).toEqual([]);
  });
});

describe("hydration ordering + sequence headroom (audit 20260831 #13/#14)", () => {
  beforeEach(() => {
    addWorkspace("wsi-a", "/repo-a");
  });

  it("sorts by closedSeq before applying the per-scope cap", () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      tab: doc(`t-${i}`, `/f${i}.md`),
      closedSeq: i + 1, // ascending — oldest first, the adversarial order
    }));
    useClosedTabScopesStore.getState().hydrateWindowClosedScopes("main", {
      "wsi-a": entries,
    });

    const ids = useClosedTabScopesStore.getState().closedIdsForScope("main", "wsi-a");
    // Newest 10 survive, newest-first — not the first 10 of the payload.
    expect(ids).toEqual(
      Array.from({ length: 10 }, (_, i) => `t-${11 - i}`),
    );
  });

  it("rejects entries whose closedSeq has no safe increment headroom", () => {
    useClosedTabScopesStore.getState().hydrateWindowClosedScopes("main", {
      "wsi-a": [
        { tab: doc("t-max", "/max.md"), closedSeq: Number.MAX_SAFE_INTEGER },
        { tab: doc("t-ok", "/ok.md"), closedSeq: 7 },
      ],
    });

    expect(
      useClosedTabScopesStore.getState().closedIdsForScope("main", "wsi-a"),
    ).toEqual(["t-ok"]);
    // nextSeq derived from the sane entry, not the ceiling.
    useClosedTabScopesStore.getState().recordClosedTab("main", doc("t-next", "/n.md"));
    const win = useClosedTabScopesStore.getState().scopesByWindow["main"]!;
    const all = Object.values(win).flat();
    expect(Math.max(...all.map((e) => e.closedSeq))).toBe(8);
  });
});

describe("placeholder-active fallback (audit round 2, R2-8)", () => {
  it("an unowned doc under a placeholder-ACTIVE window lands in window-all, not the placeholder", () => {
    setRail(true);
    useWorkspaceInstancesStore
      .getState()
      .ensurePlaceholderInstance("main", "wsi-placeholder-1");

    useClosedTabScopesStore.getState().recordClosedTab("main", doc("t-x", "/any/x.md"));

    // A placeholder is evicted the moment a real workspace arrives and its
    // closed scope is dropped with it — history under its id is orphaned.
    expect(
      useClosedTabScopesStore.getState().closedIdsForScope("main", "wsi-placeholder-1"),
    ).toEqual([]);
    expect(
      useClosedTabScopesStore.getState().closedIdsForScope("main", WINDOW_ALL_SCOPE),
    ).toEqual(["t-x"]);
  });
});

describe("hydration dedup at ACCEPTANCE, not while filtering (audit round 2, R2-9)", () => {
  beforeEach(() => {
    addWorkspace("wsi-a", "/repo-a");
    addWorkspace("wsi-b", "/repo-b");
  });

  it("an id capped OUT of one scope is not suppressed from a later scope", () => {
    // 11 entries in wsi-a; the OLDEST (t-dup, seq 1) falls beyond the cap.
    // The same id also appears in wsi-b, where it should survive.
    const aEntries = [
      { tab: doc("t-dup", "/dup.md"), closedSeq: 1 },
      ...Array.from({ length: 10 }, (_, i) => ({
        tab: doc(`a-${i}`, `/a${i}.md`),
        closedSeq: i + 2,
      })),
    ];
    useClosedTabScopesStore.getState().hydrateWindowClosedScopes("main", {
      "wsi-a": aEntries,
      "wsi-b": [{ tab: doc("t-dup", "/dup.md"), closedSeq: 20 }],
    });

    const store = useClosedTabScopesStore.getState();
    expect(store.closedIdsForScope("main", "wsi-a")).not.toContain("t-dup");
    // Before R2-9 the capped-out t-dup still entered seenIds and silently
    // deleted this entry — the exclusivity invariant only ever meant "one
    // scope per SURVIVING id".
    expect(store.closedIdsForScope("main", "wsi-b")).toEqual(["t-dup"]);
  });

  it("still keeps one scope per id when the id SURVIVES in an earlier scope", () => {
    useClosedTabScopesStore.getState().hydrateWindowClosedScopes("main", {
      "wsi-a": [{ tab: doc("t-dup", "/dup.md"), closedSeq: 5 }],
      "wsi-b": [{ tab: doc("t-dup", "/dup.md"), closedSeq: 9 }],
    });

    const store = useClosedTabScopesStore.getState();
    expect(store.closedIdsForScope("main", "wsi-a")).toEqual(["t-dup"]);
    expect(store.closedIdsForScope("main", "wsi-b")).toEqual([]);
  });

  it("duplicates INSIDE one scope beyond the cap do not shrink the survivor set", () => {
    // 10 unique newest + the same stale id repeated below them: cap keeps
    // exactly the 10 unique newest.
    const entries = [
      ...Array.from({ length: 10 }, (_, i) => ({
        tab: doc(`u-${i}`, `/u${i}.md`),
        closedSeq: 100 + i,
      })),
      { tab: doc("t-old", "/old.md"), closedSeq: 1 },
      { tab: doc("t-old", "/old.md"), closedSeq: 2 },
    ];
    useClosedTabScopesStore.getState().hydrateWindowClosedScopes("main", {
      "wsi-a": entries,
    });
    const ids = useClosedTabScopesStore.getState().closedIdsForScope("main", "wsi-a");
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain("t-old");
    expect(new Set(ids).size).toBe(10);
  });
});

describe("hydration scope whitelist (audit round 3, R3-4)", () => {
  it("drops scopes keyed by instances this window does not have, keeping siblings", () => {
    addWorkspace("wsi-a", "/repo-a");
    useClosedTabScopesStore.getState().hydrateWindowClosedScopes("main", {
      "wsi-a": [{ tab: doc("t-a", "/a.md"), closedSeq: 1 }],
      "wsi-ghost": [{ tab: doc("t-ghost", "/g.md"), closedSeq: 2 }],
      [WINDOW_ALL_SCOPE]: [{ tab: doc("t-all", "/w.md"), closedSeq: 3 }],
      [BROWSER_SCOPE]: [{ tab: browserTab("t-web"), closedSeq: 4 }],
    });

    const store = useClosedTabScopesStore.getState();
    expect(store.closedIdsForScope("main", "wsi-a")).toEqual(["t-a"]);
    // Unreachable history — nothing could ever reopen it — is rejected, not
    // retained and re-persisted forever.
    expect(store.closedIdsForScope("main", "wsi-ghost")).toEqual([]);
    expect(store.closedIdsForScope("main", WINDOW_ALL_SCOPE)).toEqual(["t-all"]);
    expect(store.closedIdsForScope("main", BROWSER_SCOPE)).toEqual(["t-web"]);
  });
});

describe("full Tab-shape validation (audit round 3, R3-2/R3-3)", () => {
  const hydrate = (scopes: Record<string, unknown>) =>
    useClosedTabScopesStore.getState().hydrateWindowClosedScopes("main", scopes);
  const winIds = () =>
    useClosedTabScopesStore.getState().closedIdsForScope("main", WINDOW_ALL_SCOPE);

  it.each([
    ["missing title", { id: "t-x", kind: "document", filePath: "/x.md", isPinned: false, formatId: "markdown" }],
    ["missing isPinned", { id: "t-x", kind: "document", title: "t-x", filePath: "/x.md", formatId: "markdown" }],
    ["missing formatId", { id: "t-x", kind: "document", title: "t-x", filePath: "/x.md", isPinned: false }],
    ["non-string formatId", { id: "t-x", kind: "document", title: "t-x", filePath: "/x.md", isPinned: false, formatId: 7 }],
  ])("rejects a document entry with %s — reopen restores entries VERBATIM", (_label, tab) => {
    hydrate({ [WINDOW_ALL_SCOPE]: [{ tab, closedSeq: 1 }] });
    expect(winIds()).toEqual([]);
  });

  it.each([
    ["missing automationMode", { persistPolicy: "restore-human" }],
    ["missing persistPolicy", { automationMode: "human" }],
    ["invalid automationMode", { automationMode: "root", persistPolicy: "restore-human" }],
    ["invalid persistPolicy", { automationMode: "human", persistPolicy: "forever" }],
  ])("rejects a browser entry with %s", (_label, fields) => {
    hydrate({
      [BROWSER_SCOPE]: [
        {
          tab: {
            id: "t-w",
            kind: "browser",
            title: "t-w",
            isPinned: false,
            url: "https://ok.example/",
            ...fields,
          },
          closedSeq: 1,
        },
      ],
    });
    expect(
      useClosedTabScopesStore.getState().closedIdsForScope("main", BROWSER_SCOPE),
    ).toEqual([]);
  });

  it("stores the CANONICAL URL, not the persisted spelling (R3-3)", () => {
    hydrate({
      [BROWSER_SCOPE]: [
        {
          tab: {
            id: "t-w",
            kind: "browser",
            title: "t-w",
            isPinned: false,
            url: "https://Ok.Example/page#frag",
            automationMode: "human",
            persistPolicy: "restore-human",
          },
          closedSeq: 1,
        },
      ],
    });
    const entry =
      useClosedTabScopesStore.getState().scopesByWindow["main"]?.[BROWSER_SCOPE]?.[0];
    expect(entry?.tab.kind).toBe("browser");
    expect(entry?.tab.kind === "browser" && entry.tab.url).toBe(
      "https://ok.example/page",
    );
  });
});
