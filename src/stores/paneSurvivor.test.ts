// @vitest-environment node
//
// WI-DSPL1.6 / D10 / R2 — closing a paned document collapses onto the OTHER
// pane's document, never onto an unrelated neighbour tab.
//
// Gap 8: round 1's version of this unit was green against the SHIPPED
// `handleTabClosed` doing nothing, because the only new observable is
// `activeTabId` and nothing asserted it.
//
// The strip order below is `[A, C, B]` and that is load-bearing.
// `nextActiveAfterRemoval` picks `remaining[Math.min(removedIndex, len-1)]`
// (`tabStoreHelpers.ts:184-193`), so with the obvious `[A, B, C]` fixture the
// neighbour pick COINCIDES with the survivor and a do-nothing implementation
// passes. With `[A, C, B]` the pick is C in both directions, so it cannot.
//
// NG1: `focusedPane` is stated in every fixture. In the mixed configuration
// `nextActiveAfterRemoval` returns `current` unchanged and `current` already IS
// the survivor, so the assertions pass vacuously for an implementation that
// never touches the alias.
import { beforeEach, describe, expect, it } from "vitest";
import { useTabStore } from "./tabStore";
import { usePaneStore, DEFAULT_SPLIT } from "./paneStore";

const W = "main";

/** Strip order [A, C, B], split on A (primary) / B (secondary). */
function splitFixture() {
  const a = useTabStore.getState().createTab(W, null);
  const c = useTabStore.getState().createTab(W, null);
  const b = useTabStore.getState().createTab(W, null);
  expect(useTabStore.getState().tabs[W]?.map((t) => t.id)).toEqual([a, c, b]);

  useTabStore.getState().setActiveTab(W, a);
  usePaneStore.getState().openSplit(W, b); // primary A, secondary B, focus secondary
  return { a, b, c };
}

beforeEach(() => {
  useTabStore.setState({ tabs: {}, activeTabId: {}, lastActiveBrowserPageId: {}, untitledCounter: 0 });
  usePaneStore.setState({ byWindow: {} });
});

describe("closing a paned tab collapses onto the survivor (R2)", () => {
  it("closing the SECONDARY's document leaves the primary's, not a neighbour", () => {
    const { a, b, c } = splitFixture();
    usePaneStore.getState().setFocusedPane(W, "secondary");
    expect(useTabStore.getState().activeTabId[W]).toBe(b); // precondition, not vacuous

    useTabStore.getState().closeTab(W, b);

    expect(usePaneStore.getState().getSplit(W)).toEqual({ ...DEFAULT_SPLIT, primaryTabId: a });
    expect(useTabStore.getState().activeTabId[W]).toBe(a);
    expect(useTabStore.getState().activeTabId[W]).not.toBe(c);
  });

  it("closing the PRIMARY's document promotes the secondary's", () => {
    const { a, b, c } = splitFixture();
    usePaneStore.getState().setFocusedPane(W, "primary");
    expect(useTabStore.getState().activeTabId[W]).toBe(a); // precondition

    useTabStore.getState().closeTab(W, a);

    expect(usePaneStore.getState().getSplit(W)).toEqual({ ...DEFAULT_SPLIT, primaryTabId: b });
    expect(useTabStore.getState().activeTabId[W]).toBe(b);
    expect(useTabStore.getState().activeTabId[W]).not.toBe(c);
  });

  it("collapses to no split when the survivor is the last document", () => {
    const a = useTabStore.getState().createTab(W, null);
    const b = useTabStore.getState().createTab(W, null);
    useTabStore.getState().setActiveTab(W, a);
    usePaneStore.getState().openSplit(W, b);

    useTabStore.getState().closeTab(W, b);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
    expect(useTabStore.getState().activeTabId[W]).toBe(a);
  });

  it("a DECLINED (pinned) close leaves the split byte-identical (NG2 clause f)", () => {
    const { b } = splitFixture();
    useTabStore.getState().togglePin(W, b);
    const before = { ...usePaneStore.getState().getSplit(W) };

    expect(useTabStore.getState().closeTab(W, b)).toBe(false);
    expect(usePaneStore.getState().getSplit(W)).toEqual(before);
  });

  it("DETACHING the secondary's document also collapses onto the survivor", () => {
    // The pre-existing detach case asserts only `enabled === false`, which was
    // already true before R2 — a regression that collapsed without promoting,
    // or promoted the wrong pane, passes it. Detach takes the same
    // `removeTabAt` path, so it needs the same `[A, C, B]` fixture and the same
    // alias assertion.
    const { a, b, c } = splitFixture();
    usePaneStore.getState().setFocusedPane(W, "secondary");
    expect(useTabStore.getState().activeTabId[W]).toBe(b);

    useTabStore.getState().detachTab(W, b);

    expect(usePaneStore.getState().getSplit(W)).toEqual({ ...DEFAULT_SPLIT, primaryTabId: a });
    expect(useTabStore.getState().activeTabId[W]).toBe(a);
    expect(useTabStore.getState().activeTabId[W]).not.toBe(c);
  });

  it("DETACHING the primary's document promotes the secondary's", () => {
    const { a, b, c } = splitFixture();
    usePaneStore.getState().setFocusedPane(W, "primary");
    expect(useTabStore.getState().activeTabId[W]).toBe(a);

    useTabStore.getState().detachTab(W, a);

    expect(usePaneStore.getState().getSplit(W)).toEqual({ ...DEFAULT_SPLIT, primaryTabId: b });
    expect(useTabStore.getState().activeTabId[W]).toBe(b);
    expect(useTabStore.getState().activeTabId[W]).not.toBe(c);
  });

  it("closing a tab in NEITHER pane leaves the split enabled", () => {
    const { a, b, c } = splitFixture();
    useTabStore.getState().closeTab(W, c);
    const split = usePaneStore.getState().getSplit(W);
    expect(split.enabled).toBe(true);
    expect(split.primaryTabId).toBe(a);
    expect(split.secondaryTabId).toBe(b);
  });
});
