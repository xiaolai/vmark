// @vitest-environment node
//
// WI-DSPL1.5 — "Open to the Side", the #1081 plan's other deferred follow-up
// and the only way to say "that document, beside this one". `Alt+Mod+\` picks
// the partner for you.
import { beforeEach, describe, expect, it } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import { canOpenToTheSide, openToTheSide } from "./openToTheSide";

const W = "main";
const split = () => usePaneStore.getState().getSplit(W);

beforeEach(() => {
  useTabStore.setState({ tabs: {}, activeTabId: {}, lastActiveBrowserPageId: {}, untitledCounter: 0 });
  usePaneStore.setState({ byWindow: {} });
});

describe("openToTheSide", () => {
  it("opens a split with the chosen tab beside the active one", () => {
    const a = useTabStore.getState().createTab(W, null);
    const b = useTabStore.getState().createTab(W, null);
    useTabStore.getState().setActiveTab(W, a);

    expect(canOpenToTheSide(W, b)).toBe(true);
    openToTheSide(W, b);

    const s = split();
    expect(s.enabled).toBe(true);
    expect(new Set([s.primaryTabId, s.secondaryTabId])).toEqual(new Set([a, b]));
  });

  it("is unavailable for a BROWSER tab — panes hold documents only", () => {
    useTabStore.getState().createTab(W, null);
    const p = useTabStore.getState().createBrowserPage(W, "https://one.example");
    expect(canOpenToTheSide(W, p)).toBe(false);
    openToTheSide(W, p);
    expect(split().enabled).toBe(false);
  });

  it("is unavailable for the tab that is already active", () => {
    const a = useTabStore.getState().createTab(W, null);
    expect(canOpenToTheSide(W, a)).toBe(false);
  });

  it("FOCUSES an already-paned tab rather than duplicating it (D9)", () => {
    const a = useTabStore.getState().createTab(W, null);
    const b = useTabStore.getState().createTab(W, null);
    useTabStore.getState().setActiveTab(W, a);
    openToTheSide(W, b);
    usePaneStore.getState().setFocusedPane(W, "primary");

    openToTheSide(W, b);
    const s = split();
    expect(s.focusedPane).toBe("secondary");
    expect(s.primaryTabId).toBe(a);
    expect(s.secondaryTabId).toBe(b);
    expect(s.primaryTabId).not.toBe(s.secondaryTabId);
  });

  it("replaces the NON-focused pane, leaving the document in view alone", () => {
    const a = useTabStore.getState().createTab(W, null);
    const b = useTabStore.getState().createTab(W, null);
    const c = useTabStore.getState().createTab(W, null);
    useTabStore.getState().setActiveTab(W, a);
    openToTheSide(W, b);
    usePaneStore.getState().setFocusedPane(W, "primary"); // looking at A

    openToTheSide(W, c);
    const s = split();
    expect(s.primaryTabId).toBe(a); // untouched
    expect(s.secondaryTabId).toBe(c);
  });
});
