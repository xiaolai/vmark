// WI-TNAV1.1 — the observation half of the tab-strip overflow affordance.
//
// jsdom deliberately: this needs a real document and a REAL MutationObserver.
// Only `ResizeObserver` is faked, because jsdom has none — and it is faked as a
// recording, deliberately INERT double, so a pass can never be attributed to
// the resize path.
//
// Two invariants, and each is why the work item exists:
//   1. Freshness. `.status-tabs` is `max-width: 60%`-capped, so once capped its
//      BOX stops changing while `scrollWidth` still moves as tabs are added,
//      removed or renamed. A ResizeObserver alone sees none of that.
//   2. Attachment tracking. `StatusBarTabStrip.tsx:90` renders the tablist as
//      `{showTabs && <div …>}` while the component stays mounted, so hiding the
//      status bar (F7) and showing it again leaves `ref.current` freshly
//      non-null. An effect with `[]` and an early return never re-runs, and the
//      chevrons never come back for the life of that window.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useTabStripOverflow } from "./useTabStripOverflow";

interface ResizeFake {
  constructions: number;
  observed: Element[];
  /** Typed as a plain spy: `ReturnType<typeof vi.fn>` widens to a
   *  Procedure|Constructable union that `tsconfig.test.json` refuses to call. */
  disconnect: ReturnType<typeof vi.fn<() => void>>;
  fire: () => void;
}
let fake: ResizeFake;

beforeEach(() => {
  const callbacks: ResizeObserverCallback[] = [];
  fake = {
    constructions: 0,
    observed: [],
    disconnect: vi.fn<() => void>(),
    // Never invoked automatically. Tests that want the resize path call it.
    fire: () => callbacks.forEach((cb) => cb([], {} as ResizeObserver)),
  };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: ResizeObserverCallback) {
        fake.constructions += 1;
        callbacks.push(cb);
      }
      observe(el: Element) {
        fake.observed.push(el);
      }
      disconnect() {
        fake.disconnect();
      }
      unobserve() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Build the SHIPPED nesting, not a flat container. A flat fixture makes
 *  `subtree` a free parameter that the test only appears to constrain. */
function makeStrip(scrollWidth: number, clientWidth = 400) {
  const region = document.createElement("div"); // the observed scroll region
  const tablist = document.createElement("div");
  tablist.setAttribute("role", "tablist");
  region.appendChild(tablist);
  document.body.appendChild(region);

  let sw = scrollWidth;
  let cw = clientWidth;
  let sl = 0;
  Object.defineProperty(region, "scrollWidth", { get: () => sw, configurable: true });
  Object.defineProperty(region, "clientWidth", { get: () => cw, configurable: true });
  Object.defineProperty(region, "scrollLeft", {
    get: () => sl,
    set: (v: number) => {
      sl = v;
    },
    configurable: true,
  });

  const addPill = (text: string) => {
    const pill = document.createElement("button");
    pill.setAttribute("role", "tab");
    const label = document.createElement("span");
    label.className = "tab-title";
    label.appendChild(document.createTextNode(text)); // depth 3 from the region
    pill.appendChild(label);
    tablist.appendChild(pill);
    return { pill, label };
  };

  return {
    region,
    tablist,
    addPill,
    setScrollWidth: (n: number) => {
      sw = n;
    },
    setClientWidth: (n: number) => {
      cw = n;
    },
  };
}

describe("useTabStripOverflow", () => {
  it("sees scrollWidth change with NO resize callback — childList insertion", async () => {
    const strip = makeStrip(300);
    strip.addPill("one");
    const ref = { current: strip.region as HTMLElement | null };
    const { result } = renderHook(() => useTabStripOverflow(ref));

    await waitFor(() => expect(result.current.canScrollRight).toBe(false));

    act(() => {
      strip.addPill("two");
      strip.setScrollWidth(900);
    });

    await waitFor(() => expect(result.current.canScrollRight).toBe(true));
    // The pass cannot be attributed to the resize path.
    expect(fake.constructions).toBe(1);
  });

  it("sees scrollWidth change with NO resize callback — childList removal", async () => {
    const strip = makeStrip(900);
    strip.addPill("one");
    const { pill } = strip.addPill("two");
    const ref = { current: strip.region as HTMLElement | null };
    const { result } = renderHook(() => useTabStripOverflow(ref));

    await waitFor(() => expect(result.current.canScrollRight).toBe(true));

    act(() => {
      pill.remove();
      strip.setScrollWidth(300);
    });

    await waitFor(() => expect(result.current.canScrollRight).toBe(false));
  });

  it("sees a RENAME three levels down — forces subtree AND characterData", async () => {
    // A `{childList: true}` observer passes both cases above and fails here.
    const strip = makeStrip(300);
    const { label } = strip.addPill("short");
    const ref = { current: strip.region as HTMLElement | null };
    const { result } = renderHook(() => useTabStripOverflow(ref));

    await waitFor(() => expect(result.current.canScrollRight).toBe(false));

    act(() => {
      label.firstChild!.nodeValue = "a considerably longer tab title";
      strip.setScrollWidth(900);
    });

    await waitFor(() => expect(result.current.canScrollRight).toBe(true));
  });

  it("observes a container attached AFTER mount, exactly once, and stops on detach", async () => {
    // Gap 2. `useEffect(…, [])` with an early return is permanent for the session.
    const strip = makeStrip(900);
    strip.addPill("one");
    const ref = { current: null as HTMLElement | null };
    const { result, rerender } = renderHook(() => useTabStripOverflow(ref));

    expect(result.current).toEqual({ canScrollLeft: false, canScrollRight: false });
    expect(fake.constructions).toBe(0);

    ref.current = strip.region;
    rerender();

    await waitFor(() => expect(result.current.canScrollRight).toBe(true));
    // "Exactly once" is load-bearing: an effect that re-runs every render leaks
    // an observer per keystroke, which no value assertion would ever see.
    expect(fake.constructions).toBe(1);

    rerender();
    expect(fake.constructions).toBe(1);

    ref.current = null;
    rerender();

    await waitFor(() => expect(result.current).toEqual({ canScrollLeft: false, canScrollRight: false }));
    expect(fake.disconnect).toHaveBeenCalled();
  });

  it("sees a LAYOUT-only content change with no mutation and no region resize", async () => {
    // The region is max-width-capped, so its own box stops changing; a close
    // button appearing on hover widens the content and moves scrollWidth with
    // no mutation record at all.
    const strip = makeStrip(300);
    strip.addPill("one");
    const ref = { current: strip.region as HTMLElement | null };
    const { result } = renderHook(() => useTabStripOverflow(ref));
    await waitFor(() => expect(result.current.canScrollRight).toBe(false));

    expect(fake.observed).toContain(strip.tablist);
    act(() => {
      strip.setScrollWidth(900); // layout only — no DOM mutation
      fake.fire();
    });
    await waitFor(() => expect(result.current.canScrollRight).toBe(true));
  });

  it("still honours the resize path when the DOM does not change", async () => {
    const strip = makeStrip(300);
    strip.addPill("one");
    const ref = { current: strip.region as HTMLElement | null };
    const { result } = renderHook(() => useTabStripOverflow(ref));

    await waitFor(() => expect(result.current.canScrollRight).toBe(false));

    // A window resize produces no DOM mutation: without this, the fix for one
    // trap silently creates another.
    act(() => {
      strip.setClientWidth(200);
      fake.fire();
    });

    await waitFor(() => expect(result.current.canScrollRight).toBe(true));
  });

  it("updates both flags on a real scroll event on the container", async () => {
    const strip = makeStrip(900);
    strip.addPill("one");
    const ref = { current: strip.region as HTMLElement | null };
    const { result } = renderHook(() => useTabStripOverflow(ref));

    await waitFor(() => expect(result.current).toEqual({ canScrollLeft: false, canScrollRight: true }));

    act(() => {
      strip.region.scrollLeft = 200;
      strip.region.dispatchEvent(new Event("scroll"));
    });
    await waitFor(() => expect(result.current).toEqual({ canScrollLeft: true, canScrollRight: true }));

    act(() => {
      strip.region.scrollLeft = 500; // 900 - 400
      strip.region.dispatchEvent(new Event("scroll"));
    });
    await waitFor(() => expect(result.current).toEqual({ canScrollLeft: true, canScrollRight: false }));
  });

  it("stops every observer on unmount", async () => {
    const strip = makeStrip(300);
    strip.addPill("one");
    const ref = { current: strip.region as HTMLElement | null };
    const { result, unmount } = renderHook(() => useTabStripOverflow(ref));
    await waitFor(() => expect(result.current.canScrollRight).toBe(false));

    unmount();
    expect(fake.disconnect).toHaveBeenCalled();

    // A cleanup that disconnects one observer and forgets the other shows up
    // here as an act() warning or a post-unmount update.
    act(() => {
      strip.addPill("two");
      strip.setScrollWidth(900);
      fake.fire();
    });
    expect(result.current.canScrollRight).toBe(false);
  });

  it("constructs no observer and reports no overflow for a null ref", () => {
    const { result } = renderHook(() => useTabStripOverflow({ current: null }));
    expect(result.current).toEqual({ canScrollLeft: false, canScrollRight: false });
    expect(fake.constructions).toBe(0);
  });
});
