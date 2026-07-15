// WI-S2.2 — browserHistoryStore: a real record schema with reducer rules.
//
// "A visited list from nav events" is not a spec — it can mean commit history, finish
// history, redirect history, or tab history, and each produces a different list (Codex
// v3, D4#1). These tests ARE the reducer truth table.
//
// Session-only, and deliberately: a browsing history on disk is sensitive, and nothing
// here should make that decision by accident.
import { describe, it, expect, beforeEach } from "vitest";
import { useBrowserHistoryStore } from "./browserHistoryStore";

const W = "main";
const TAB = "tab-1";

beforeEach(() => {
  useBrowserHistoryStore.setState({ byWindow: {} });
});

function entries(win = W) {
  return useBrowserHistoryStore.getState().byWindow[win] ?? [];
}

describe("record", () => {
  it("records a commit with its schema", () => {
    useBrowserHistoryStore.getState().record(W, {
      tabId: TAB,
      url: "https://a.com/x",
      transitionKind: "typed",
    });
    const [e] = entries();
    expect(e).toMatchObject({
      tabId: TAB,
      url: "https://a.com/x",
      transitionKind: "typed",
      title: "",
    });
    expect(e.id).toBeTruthy();
    expect(e.committedAt).toBeTypeOf("number");
  });

  it("keeps newest first", () => {
    const s = useBrowserHistoryStore.getState();
    s.record(W, { tabId: TAB, url: "https://a.com/", transitionKind: "typed" });
    s.record(W, { tabId: TAB, url: "https://b.com/", transitionKind: "link" });
    expect(entries().map((e) => e.url)).toEqual(["https://b.com/", "https://a.com/"]);
  });

  // A reload commits the SAME url again. Appending would fill the list with one page.
  it("collapses a reload of the same url in the same tab into the existing entry", () => {
    const s = useBrowserHistoryStore.getState();
    s.record(W, { tabId: TAB, url: "https://a.com/", transitionKind: "typed" });
    const first = entries()[0];
    s.record(W, { tabId: TAB, url: "https://a.com/", transitionKind: "reload" });

    expect(entries()).toHaveLength(1);
    // Same entry, refreshed — not a new one.
    expect(entries()[0].id).toBe(first.id);
    expect(entries()[0].committedAt).toBeGreaterThanOrEqual(first.committedAt);
  });

  // A redirect chain commits each hop. The user went to ONE place.
  it("folds a redirect into the entry it redirected from", () => {
    const s = useBrowserHistoryStore.getState();
    s.record(W, { tabId: TAB, url: "https://a.com/", transitionKind: "typed" });
    s.record(W, { tabId: TAB, url: "https://a.com/final", transitionKind: "redirect" });

    expect(entries()).toHaveLength(1);
    // The entry now names where you actually ended up...
    expect(entries()[0].url).toBe("https://a.com/final");
    // ...but remembers that you got there by typing, not by being redirected.
    expect(entries()[0].transitionKind).toBe("typed");
  });

  it("does NOT collapse the same url reached in a different tab", () => {
    const s = useBrowserHistoryStore.getState();
    s.record(W, { tabId: "tab-1", url: "https://a.com/", transitionKind: "typed" });
    s.record(W, { tabId: "tab-2", url: "https://a.com/", transitionKind: "typed" });
    expect(entries()).toHaveLength(2);
  });

  it("does NOT collapse a revisit after visiting something else", () => {
    const s = useBrowserHistoryStore.getState();
    s.record(W, { tabId: TAB, url: "https://a.com/", transitionKind: "typed" });
    s.record(W, { tabId: TAB, url: "https://b.com/", transitionKind: "link" });
    s.record(W, { tabId: TAB, url: "https://a.com/", transitionKind: "back-forward" });
    // Going back to a.com is a real event in the story of the session.
    expect(entries()).toHaveLength(3);
  });

  it("keeps each window's history separate", () => {
    const s = useBrowserHistoryStore.getState();
    s.record("main", { tabId: TAB, url: "https://a.com/", transitionKind: "typed" });
    s.record("doc-2", { tabId: "tab-9", url: "https://b.com/", transitionKind: "typed" });
    expect(entries("main")).toHaveLength(1);
    expect(entries("doc-2")).toHaveLength(1);
    expect(entries("doc-2")[0].url).toBe("https://b.com/");
  });

  it("caps the list so a long session cannot grow without bound", () => {
    const s = useBrowserHistoryStore.getState();
    for (let i = 0; i < 260; i++) {
      s.record(W, { tabId: TAB, url: `https://a.com/${i}`, transitionKind: "link" });
    }
    expect(entries().length).toBeLessThanOrEqual(200);
    // The newest survive; the oldest are evicted.
    expect(entries()[0].url).toBe("https://a.com/259");
  });
});

describe("setTitle", () => {
  // The title arrives on FINISH, after the commit that created the entry.
  it("attaches a late-arriving title to the entry it belongs to", () => {
    const s = useBrowserHistoryStore.getState();
    s.record(W, { tabId: TAB, url: "https://a.com/", transitionKind: "typed" });
    s.setTitle(W, TAB, "https://a.com/", "Example Site");
    expect(entries()[0].title).toBe("Example Site");
  });

  it("ignores a title for a page that has since been navigated away from", () => {
    const s = useBrowserHistoryStore.getState();
    s.record(W, { tabId: TAB, url: "https://a.com/", transitionKind: "typed" });
    s.record(W, { tabId: TAB, url: "https://b.com/", transitionKind: "link" });
    // A slow finish event for the page we already left must not retitle the new one.
    s.setTitle(W, TAB, "https://a.com/", "Old Page");
    expect(entries()[0].title).toBe(""); // b.com, still untitled
    expect(entries()[1].title).toBe("Old Page"); // a.com, correctly titled
  });

  it("is a no-op for an unknown window", () => {
    expect(() =>
      useBrowserHistoryStore.getState().setTitle("ghost", TAB, "https://a.com/", "T"),
    ).not.toThrow();
  });
});

describe("clear", () => {
  it("drops a window's history — the privacy escape hatch", () => {
    const s = useBrowserHistoryStore.getState();
    s.record(W, { tabId: TAB, url: "https://a.com/", transitionKind: "typed" });
    s.clear(W);
    expect(entries()).toHaveLength(0);
  });
});
