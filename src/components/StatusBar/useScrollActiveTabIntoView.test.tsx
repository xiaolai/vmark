// WI-TNAV1.3 — the EFFECT half. jsdom, because it needs a real document.
//
// This file exists because a review found the effect untested while two
// comments claimed otherwise. The pure `scrollDecision` tests beside it are
// thorough and prove nothing about whether anything actually scrolls — and
// `src/test/setup.ts` installs a global no-op `scrollIntoView`, so F2 is
// unverifiable in this tier unless a test spies on it deliberately. This does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useScrollActiveTabIntoView, BROWSER_PILL_KEY } from "./scrollActiveTabIntoView";

let spy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  spy = vi.fn();
  Element.prototype.scrollIntoView = spy as unknown as Element["scrollIntoView"];
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** Region containing three document pills plus the synthetic workspace pill. */
function makeRegion() {
  const region = document.createElement("div");
  for (const id of ["t1", "t2", "t3"]) {
    const pill = document.createElement("button");
    pill.setAttribute("data-tab-id", id);
    region.appendChild(pill);
  }
  const workspace = document.createElement("button");
  workspace.setAttribute("data-workspace-tab", "");
  region.appendChild(workspace);
  document.body.appendChild(region);
  return { region, ref: { current: region as HTMLElement | null }, workspace };
}

const source = (o: Partial<Parameters<typeof useScrollActiveTabIntoView>[1]> = {}) => ({
  activeTabId: "t1" as string | null,
  browserWorkspaceActive: false,
  activeBrowserPageId: null,
  isDragging: false,
  ...o,
});

describe("useScrollActiveTabIntoView", () => {
  it("scrolls the newly active pill into view exactly once", () => {
    const { ref } = makeRegion();
    const { rerender } = renderHook((p: ReturnType<typeof source>) => useScrollActiveTabIntoView(ref, p), {
      initialProps: source({ activeTabId: "t1" }),
    });
    spy.mockClear();

    rerender(source({ activeTabId: "t3" }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.instances[0]).toBe(document.querySelector('[data-tab-id="t3"]'));
    expect(spy.mock.calls[0][0]).toMatchObject({ block: "nearest", inline: "nearest" });
  });

  it("does not scroll again when the key is unchanged", () => {
    const { ref } = makeRegion();
    const { rerender } = renderHook((p: ReturnType<typeof source>) => useScrollActiveTabIntoView(ref, p), {
      initialProps: source({ activeTabId: "t2" }),
    });
    spy.mockClear();
    rerender(source({ activeTabId: "t2" }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("reveals the BROWSER pill, which activeTabId can never point at", () => {
    // `StatusBar.tsx` passes `activeTabId={null}` whenever the browser pill is
    // active, so an activeTabId-keyed effect could never reach this element.
    const { ref, workspace } = makeRegion();
    const { rerender } = renderHook((p: ReturnType<typeof source>) => useScrollActiveTabIntoView(ref, p), {
      initialProps: source({ activeTabId: "t1" }),
    });
    spy.mockClear();

    rerender(source({ activeTabId: null, browserWorkspaceActive: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.instances[0]).toBe(workspace);
    expect(BROWSER_PILL_KEY).toBeTruthy();
  });

  it("is suppressed while a reorder drag is in flight", () => {
    const { ref } = makeRegion();
    const { rerender } = renderHook((p: ReturnType<typeof source>) => useScrollActiveTabIntoView(ref, p), {
      initialProps: source({ activeTabId: "t1" }),
    });
    spy.mockClear();
    rerender(source({ activeTabId: "t3", isDragging: true }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("honours prefers-reduced-motion at decision time, not module load", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q }));
    const { ref } = makeRegion();
    const { rerender } = renderHook((p: ReturnType<typeof source>) => useScrollActiveTabIntoView(ref, p), {
      initialProps: source({ activeTabId: "t1" }),
    });
    spy.mockClear();
    rerender(source({ activeTabId: "t2" }));
    expect(spy.mock.calls[0][0]).toMatchObject({ behavior: "auto" });
  });

  it("does not throw when the active tab renders no pill", () => {
    // A tab owned by a hidden workspace instance is active but not rendered.
    const { ref } = makeRegion();
    const { rerender } = renderHook((p: ReturnType<typeof source>) => useScrollActiveTabIntoView(ref, p), {
      initialProps: source({ activeTabId: "t1" }),
    });
    spy.mockClear();
    expect(() => rerender(source({ activeTabId: "not-rendered" }))).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not throw for a tab id containing CSS-selector metacharacters", () => {
    const { ref, region } = makeRegion();
    const odd = document.createElement("button");
    odd.setAttribute("data-tab-id", 'tab:1.2["x"]');
    region.appendChild(odd);
    const { rerender } = renderHook((p: ReturnType<typeof source>) => useScrollActiveTabIntoView(ref, p), {
      initialProps: source({ activeTabId: "t1" }),
    });
    spy.mockClear();
    expect(() => rerender(source({ activeTabId: 'tab:1.2["x"]' }))).not.toThrow();
    expect(spy.mock.instances[0]).toBe(odd);
  });
});
