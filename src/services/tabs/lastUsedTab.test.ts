// @vitest-environment node
//
// WI-TNAV2.2 — `tab.lastUsed`, against the REAL store and the REAL activation
// bus. An isolated store test cannot decide this: the Phase 0 defect
// (`createBrowserPage` never announcing) was invisible to one, and D2's
// involution depends on the store's post-close neighbour announcement.
import { beforeEach, describe, expect, it } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useTabMruStore } from "@/stores/tabMruStore";
import { notifyTabActivated, withActivationOrigin } from "@/stores/tabActivationBus";
import { lastUsedTabId } from "./lastUsedTab";

const W = "main";
const press = (): void => {
  const target = lastUsedTabId(W);
  if (target) useTabStore.getState().setActiveTab(W, target);
};
const active = () => useTabStore.getState().activeTabId[W] ?? null;

beforeEach(() => {
  useTabStore.setState({ tabs: {}, activeTabId: {}, lastActiveBrowserPageId: {}, untitledCounter: 0 });
  useTabMruStore.getState().reset();
});

describe("tab.lastUsed", () => {
  it("returns to the origin on two presses (D2 involution)", () => {
    const a = useTabStore.getState().createTab(W, null);
    const b = useTabStore.getState().createTab(W, null);
    expect(active()).toBe(b);

    press();
    expect(active()).toBe(a);
    press();
    expect(active()).toBe(b);
  });

  it("round-trips across a browser page created between two documents", () => {
    // The integration shape Phase 0 unblocked: before WI-TNAV0.1 the browser
    // creation never announced, so the MRU could not see it at all.
    useTabStore.getState().createTab(W, null);
    useTabStore.getState().createTab(W, null);
    const p = useTabStore.getState().createBrowserPage(W, "https://one.example");
    expect(active()).toBe(p);

    press();
    press();
    expect(active()).toBe(p);
  });

  it.each([
    { label: "zero tabs", make: () => {} },
    { label: "one tab", make: () => void useTabStore.getState().createTab(W, null) },
  ])("no-ops with $label", ({ make }) => {
    make();
    const before = active();
    press();
    expect(active()).toBe(before);
  });

  it("skips a stale MRU entry and still MOVES (progress, not just closure)", () => {
    // A dead key satisfies a closure-only assertion by standing still:
    // `setActiveTabGuarded` refuses the dead id and the pre-existing active tab
    // is live and is not the excluded one.
    const a = useTabStore.getState().createTab(W, null);
    const b = useTabStore.getState().createTab(W, null);
    const c = useTabStore.getState().createTab(W, null);
    useTabStore.getState().setActiveTab(W, a);
    useTabStore.getState().closeTab(W, b);

    const before = active();
    press();
    expect(active()).not.toBe(before);
    expect(useTabStore.getState().tabs[W]?.some((t) => t.id === active())).toBe(true);
    expect(active()).toBe(c);
  });

  it("activates MRU[0] when the active tab is NOT the MRU head (D13)", () => {
    // D13's whole point, and the case a literal `mru[1]` implementation fails.
    // Reachable in production: with the workspace rail on,
    // `nextActiveAfterRemoval` picks by RAW STRIP INDEX while
    // `visibleWindowTabs` filters by instance, so a close can leave the alias
    // pointing somewhere the MRU head is not. Here it is produced directly, by
    // moving the alias WITHOUT announcing — which is what a background
    // activation followed by an alias restore does.
    const a = useTabStore.getState().createTab(W, null);
    const b = useTabStore.getState().createTab(W, null);
    const c = useTabStore.getState().createTab(W, null);
    expect(useTabMruStore.getState().keys(W)).toEqual([c, b, a]);

    useTabStore.setState((st) => ({ activeTabId: { ...st.activeTabId, [W]: a } }));
    expect(active()).toBe(a);

    press();
    // The first key that is neither the active key nor unresolvable — c.
    // A literal `mru[1]` yields b, skipping the tab the user last chose.
    expect(active()).toBe(c);
    expect(active()).not.toBe(b);
  });

  it("no-ops when the only other visible tab was opened in the BACKGROUND (D12)", () => {
    // A positional fallback here lands the user on a document they never saw —
    // exactly what D5 exists to prevent.
    const a = useTabStore.getState().createTab(W, null);
    const bg = useTabStore.getState().createTab(W, null);
    useTabStore.getState().setActiveTab(W, a);
    // Re-seat the MRU as if `bg` had only ever been announced in the background.
    useTabMruStore.getState().reset();
    notifyTabActivated(W, bg, "background");
    notifyTabActivated(W, a, "user");

    expect(active()).toBe(a);
    press();
    expect(active()).toBe(a);
  });

  it("no-ops in a browser-only window, where the MRU holds one key (D6/D12)", () => {
    const p1 = useTabStore.getState().createBrowserPage(W, "https://one.example");
    const p2 = useTabStore.getState().createBrowserPage(W, "https://two.example");
    expect(p1).not.toBe(p2);
    const before = active();
    press();
    expect(active()).toBe(before);
  });

  it("resolves the browser entry to the REMEMBERED page, not a positional guess", () => {
    const p1 = useTabStore.getState().createBrowserPage(W, "https://one.example");
    const p2 = useTabStore.getState().createBrowserPage(W, "https://two.example");
    const doc = useTabStore.getState().createTab(W, null);
    expect(active()).toBe(doc);

    press();
    // p2 is the remembered page; `pages[0]` would give p1.
    expect(active()).toBe(p2);
    expect(active()).not.toBe(p1);
  });

  it("repairs a STALE lastActiveBrowserPageId instead of going dead (NG4)", () => {
    // Reachable: the pointer is only rewritten when the SUCCESSOR is a browser
    // tab, so activating a document and then closing the remembered page leaves
    // it naming a page that no longer exists.
    const p1 = useTabStore.getState().createBrowserPage(W, "https://one.example");
    const p2 = useTabStore.getState().createBrowserPage(W, "https://two.example");
    const doc = useTabStore.getState().createTab(W, null);
    useTabStore.getState().closeTab(W, p2);
    useTabStore.getState().setActiveTab(W, doc);

    const before = active();
    press();
    expect(active()).toBe(p1);
    expect(active()).not.toBe(before);
  });
});

describe("tab.lastUsed vs a real MCP background open (H1)", () => {
  it("does not jump to a document the AI opened in the background", () => {
    // The reviewer found that `origin: "background"` had NO production emitter:
    // the parameter, the type-parity guard and the tests all shipped while the
    // call site did not, so D5/D12 did not exist in the app. This drives the
    // REAL `workspaceOpen` region rather than hand-seeding the MRU.
    const a = useTabStore.getState().createTab(W, null);
    const b = useTabStore.getState().createTab(W, null);
    useTabStore.getState().setActiveTab(W, a);

    // Exactly what workspaceOpen does: create (which activates), then restore.
    const opened = withActivationOrigin("background", () => {
      const id = useTabStore.getState().createTab(W, "/mcp-opened.md");
      useTabStore.getState().setActiveTab(W, a); // restoreBackgroundActivation
      return id;
    });

    expect(active()).toBe(a);
    press();
    // Without the label the MRU head is the MCP-opened file and this lands there.
    expect(active()).toBe(b);
    expect(active()).not.toBe(opened);
  });

  it("restores the scope even when the wrapped work throws", () => {
    const a = useTabStore.getState().createTab(W, null);
    expect(() =>
      withActivationOrigin("background", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");

    // A leaked scope would make this ordinary activation invisible to the MRU.
    const b = useTabStore.getState().createTab(W, null);
    useTabStore.getState().setActiveTab(W, a);
    press();
    expect(active()).toBe(b);
  });
});
