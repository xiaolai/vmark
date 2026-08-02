/**
 * The host-search seam.
 *
 * The find bar is app chrome, but highlighting and replacing happen inside
 * plugins on both surfaces — so they read the query and report matches back
 * without owning the bar.
 *
 * @coordinates-with plugins/shared/hostSearch.ts
 * @module plugins/shared/hostSearch.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostSearch, bindHostSearch, resetHostSearch } from "./hostSearch";

afterEach(resetHostSearch);

describe("an unbound host reports a CLOSED bar", () => {
  it("yields an empty query, which every caller reads as nothing to do", () => {
    const q = hostSearch.current();
    expect(q.isOpen).toBe(false);
    expect(q.query).toBe("");
    expect(q.replaceText).toBe("");
  });

  it("swallows reports and navigation rather than throwing", () => {
    expect(() => hostSearch.reportMatches(3, 1)).not.toThrow();
    expect(() => hostSearch.findNext()).not.toThrow();
  });
});

describe("binding wires the real bar", () => {
  it("reads the query LIVE — the user retypes constantly", () => {
    // Built explicitly, not spread from `hostSearch.current()` — that reads
    // the BOUND function, which is this one, and recurses.
    let query = "foo";
    const base = {
      isOpen: true,
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
      currentIndex: 0,
      replaceText: "",
    };
    bindHostSearch({ current: () => ({ ...base, query }) });
    expect(hostSearch.current().query).toBe("foo");
    query = "bar";
    expect(hostSearch.current().query).toBe("bar");
  });

  it("passes match counts through", () => {
    const report = vi.fn();
    bindHostSearch({ reportMatches: report });
    hostSearch.reportMatches(7, 2);
    expect(report).toHaveBeenCalledWith(7, 2);
  });

  it("notifies on change so highlighting can redraw", () => {
    const listeners: Array<() => void> = [];
    bindHostSearch({ onChange: (fn) => (listeners.push(fn), () => {}) });
    const redraw = vi.fn();
    hostSearch.onChange(redraw);
    listeners.forEach((fn) => fn());
    expect(redraw).toHaveBeenCalledOnce();
  });
});

describe("the navigation members", () => {
  beforeEach(resetHostSearch);

  it("defaults to no-ops and a zero match count", () => {
    expect(() => hostSearch.findPrevious()).not.toThrow();
    expect(() => hostSearch.open()).not.toThrow();
    expect(hostSearch.current().matchCount).toBe(0);
  });

  it("routes open, findNext and findPrevious to the binding", () => {
    const open = vi.fn();
    const findNext = vi.fn();
    const findPrevious = vi.fn();
    bindHostSearch({ open, findNext, findPrevious });
    hostSearch.open();
    hostSearch.findNext();
    hostSearch.findPrevious();
    expect(open).toHaveBeenCalledTimes(1);
    expect(findNext).toHaveBeenCalledTimes(1);
    expect(findPrevious).toHaveBeenCalledTimes(1);
  });
});
