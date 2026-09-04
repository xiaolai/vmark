// @vitest-environment node
// Audit 2026-09-03 round 4 (#87) — a failure is judged by the ORDER of navigation ids,
// not by a lookup in a ring of committed ids. The driver mints `nav-<tabId>-<sequence>`
// from one monotonic per-tab counter (registry_navigation.rs), so a failure whose
// sequence is below the highest this tab has shown is about a page nobody is looking
// at — whether or not that navigation ever committed, and however many navigations
// ago it was.
import { describe, expect, it } from "vitest";
import { NavigationOrder, navigationSequence } from "./navigationOrder";

const TAB = "tab-3f2a";
const nav = (n: number | string) => `nav-${TAB}-${n}`;

describe("navigationSequence", () => {
  it.each([
    [nav(1), 1],
    [nav(0), 0],
    [nav(42), 42],
    [nav("9007199254740991"), 9007199254740991],
  ])("parses %s → %d", (id, sequence) => {
    expect(navigationSequence(TAB, id)).toBe(sequence);
  });

  it.each([
    ["an older driver's stand-in", `legacy-${TAB}`],
    ["another tab's ticket", "nav-tab-other-7"],
    ["a non-canonical number (leading zero)", nav("07")],
    ["a signed number", nav("-1")],
    ["a decimal", nav("1.5")],
    ["a non-numeric tail", nav("x")],
    ["an empty tail", nav("")],
    ["a sequence past the safe-integer range", nav("9007199254740993")],
    ["a prefix-only id", `nav-${TAB}`],
    ["the tab id without `nav-`", `${TAB}-7`],
    ["an empty string", ""],
  ])("carries no order: %s", (_label, id) => {
    expect(navigationSequence(TAB, id)).toBeUndefined();
  });

  it("is strict about the tab: a tab id that prefixes another does not claim its tickets", () => {
    // `tab-1` vs `tab-10`: `nav-tab-10-3` must not parse as tab-1's sequence.
    expect(navigationSequence("tab-1", "nav-tab-10-3")).toBeUndefined();
    expect(navigationSequence("tab-10", "nav-tab-10-3")).toBe(3);
    // `tab-1` vs `tab-1-2`: the tail `2-5` is not a sequence.
    expect(navigationSequence("tab-1", "nav-tab-1-2-5")).toBeUndefined();
    expect(navigationSequence("tab-1-2", "nav-tab-1-2-5")).toBe(5);
  });
});

describe("NavigationOrder", () => {
  it("knows nothing before the first observation: no id is superseded", () => {
    const order = new NavigationOrder();
    expect(order.isSuperseded(TAB, nav(1))).toBe(false);
  });

  it("an id below the highest observed is superseded; the highest and anything newer are not", () => {
    const order = new NavigationOrder();
    order.observe(TAB, nav(1));
    order.observe(TAB, nav(2));
    expect(order.isSuperseded(TAB, nav(1))).toBe(true);
    expect(order.isSuperseded(TAB, nav(2))).toBe(false);
    expect(order.isSuperseded(TAB, nav(3))).toBe(false); // not yet seen, but newer
  });

  it("observing an older id never lowers the highest (events cross IPC out of order)", () => {
    const order = new NavigationOrder();
    order.observe(TAB, nav(5));
    order.observe(TAB, nav(2));
    expect(order.isSuperseded(TAB, nav(4))).toBe(true);
    expect(order.isSuperseded(TAB, nav(5))).toBe(false);
  });

  // A provisional load (DNS, TLS, refused) never commits, so it never appears in a
  // `navigated`; its failure's own id is still the newest thing the tab did.
  it("a provisional id counts: observing a failure's own id supersedes everything below it", () => {
    const order = new NavigationOrder();
    order.observe(TAB, nav(1)); // committed
    order.observe(TAB, nav(2)); // failed provisionally — observed by the failure handler
    expect(order.isSuperseded(TAB, nav(1))).toBe(true);
    expect(order.isSuperseded(TAB, nav(2))).toBe(false);
  });

  it("has no ring to evict from: the first navigation is still superseded after a hundred more", () => {
    const order = new NavigationOrder();
    for (let n = 1; n <= 101; n++) order.observe(TAB, nav(n));
    expect(order.isSuperseded(TAB, nav(1))).toBe(true);
    expect(order.isSuperseded(TAB, nav(93))).toBe(true);
    expect(order.isSuperseded(TAB, nav(101))).toBe(false);
  });

  it("an id without order is neither recorded nor superseded", () => {
    const order = new NavigationOrder();
    order.observe(TAB, nav(3));
    order.observe(TAB, `legacy-${TAB}`);
    order.observe(TAB, "nav-tab-other-99");
    expect(order.isSuperseded(TAB, `legacy-${TAB}`)).toBe(false);
    expect(order.isSuperseded(TAB, "nav-tab-other-99")).toBe(false);
    expect(order.isSuperseded(TAB, nav(2))).toBe(true); // still 3: the unordered ids changed nothing
    expect(order.isSuperseded(TAB, nav(3))).toBe(false);
  });

  it("tabs are independent", () => {
    const order = new NavigationOrder();
    order.observe(TAB, nav(2));
    order.observe("tab-b", "nav-tab-b-1");
    expect(order.isSuperseded("tab-b", "nav-tab-b-1")).toBe(false);
    expect(order.isSuperseded(TAB, nav(1))).toBe(true);
  });

  it("forget drops one tab and leaves the others alone", () => {
    const order = new NavigationOrder();
    order.observe(TAB, nav(2));
    order.observe("tab-b", "nav-tab-b-2");
    order.forget(TAB);
    expect(order.isSuperseded(TAB, nav(1))).toBe(false);
    expect(order.isSuperseded("tab-b", "nav-tab-b-1")).toBe(true);
    expect(() => order.forget("never-seen")).not.toThrow();
  });

  it("a tab id named like a prototype property is an ordinary key", () => {
    const order = new NavigationOrder();
    expect(order.isSuperseded("constructor", "nav-constructor-1")).toBe(false);
    order.observe("toString", "nav-toString-2");
    expect(order.isSuperseded("toString", "nav-toString-1")).toBe(true);
  });
});
