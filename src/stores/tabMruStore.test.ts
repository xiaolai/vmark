// @vitest-environment node
//
// WI-TNAV2.1 — most-recently-used tab order.
//
// The S6 reference-model case is the real guard: append-only, lookup-table and
// swap-with-front implementations all satisfy the readable anchors and die
// against a generated command sequence. Its alphabet includes REMOVALS, because
// a "prune by re-deriving from the live tab list" implementation passes every
// membership assertion while silently replacing the user's MRU with strip order.
import { beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { useTabStore } from "./tabStore";
import { notifyTabActivated } from "./tabActivationBus";
import { useTabMruStore, BROWSER_MRU_KEY, ACTIVATION_ORIGINS } from "./tabMruStore";

const W = "main";
const mru = (w = W) => useTabMruStore.getState().keys(w);

beforeEach(() => {
  useTabStore.setState({ tabs: {}, activeTabId: {}, lastActiveBrowserPageId: {}, untitledCounter: 0 });
  useTabMruStore.getState().reset();
});

describe("tabMruStore — readable anchors", () => {
  it("yields [C, B, A] after creating A, B, C", () => {
    const a = useTabStore.getState().createTab(W, null);
    const b = useTabStore.getState().createTab(W, null);
    const c = useTabStore.getState().createTab(W, null);
    expect(mru()).toEqual([c, b, a]);
  });

  it("re-announces the neighbour when the ACTIVE front entry closes (D11)", () => {
    // The shape both other removal anchors miss: they close a NON-active tab,
    // where the re-announcement is a front no-op and therefore invisible.
    const a = useTabStore.getState().createTab(W, null);
    const b = useTabStore.getState().createTab(W, null);
    const c = useTabStore.getState().createTab(W, null);
    useTabStore.getState().setActiveTab(W, a);
    expect(mru()).toEqual([a, c, b]);

    useTabStore.getState().closeTab(W, a);
    // Closing index 0 leaves [b, c]; tabStore picks remaining[min(0,1)] = b,
    // re-announced at origin "user". Deliberately NOT [c, b].
    expect(mru()).toEqual([b, c]);
  });

  it("preserves the order of the rest when a middle entry closes (Gap 3)", () => {
    const a = useTabStore.getState().createTab(W, null);
    const b = useTabStore.getState().createTab(W, null);
    const c = useTabStore.getState().createTab(W, null);
    useTabStore.getState().closeTab(W, b);
    // Asserted as a LIST, not as "contains c and a": a re-derive implementation
    // yields [a, c] and would pass a membership assertion.
    expect(mru()).toEqual([c, a]);
  });

  it("prunes a closed tab and keeps the survivor list exact", () => {
    const a = useTabStore.getState().createTab(W, null);
    const b = useTabStore.getState().createTab(W, null);
    useTabStore.getState().closeTab(W, a);
    expect(mru()).toEqual([b]);
  });

  it("clears only the removed window", () => {
    useTabStore.getState().createTab(W, null);
    const other = useTabStore.getState().createTab("w2", null);
    const before = [...mru("w2")];
    useTabStore.getState().removeWindow(W);
    expect(mru(W)).toEqual([]);
    expect(mru("w2")).toEqual(before);
    expect(mru("w2")).toEqual([other]);
  });
});

describe("tabMruStore — ignore paths are TRUE no-ops (Gap 4)", () => {
  const seed = () => {
    const a = useTabStore.getState().createTab(W, null);
    const b = useTabStore.getState().createTab(W, null);
    useTabStore.getState().setActiveTab(W, a);
    return { a, b };
  };

  it("does not notify subscribers on a front re-activation", () => {
    const { a } = seed();
    const spy = vi.fn();
    const off = useTabMruStore.subscribe(spy);
    notifyTabActivated(W, a, "user");
    off();
    expect(mru()[0]).toBe(a);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(ACTIVATION_ORIGINS.filter((o) => o !== "user"))(
    "does not notify subscribers for origin %s",
    (origin) => {
      const { a, b } = seed();
      const spy = vi.fn();
      const off = useTabMruStore.subscribe(spy);
      notifyTabActivated(W, b, origin);
      off();
      expect(mru()).toEqual([a, b]);
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it("does not notify subscribers for a null tabId", () => {
    const { a, b } = seed();
    const spy = vi.fn();
    const off = useTabMruStore.subscribe(spy);
    notifyTabActivated(W, null);
    off();
    expect(mru()).toEqual([a, b]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("DOES move and DOES notify on a non-front re-activation", () => {
    // The complement, kept so "never notify" cannot be the implementation.
    const { a, b } = seed();
    const spy = vi.fn();
    const off = useTabMruStore.subscribe(spy);
    notifyTabActivated(W, b, "user");
    off();
    expect(mru()).toEqual([b, a]);
    expect(spy).toHaveBeenCalled();
  });
});

describe("tabMruStore — the browser workspace is ONE entry (D6)", () => {
  it("keeps one entry across two pages and a return from a document", () => {
    const p1 = useTabStore.getState().createBrowserPage(W, "https://one.example");
    expect(mru()).toEqual([BROWSER_MRU_KEY]);

    const p2 = useTabStore.getState().createBrowserPage(W, "https://two.example");
    expect(mru()).toEqual([BROWSER_MRU_KEY]);

    const doc = useTabStore.getState().createTab(W, null);
    expect(mru()).toEqual([doc, BROWSER_MRU_KEY]);

    useTabStore.getState().setActiveTab(W, p2);
    expect(mru()).toEqual([BROWSER_MRU_KEY, doc]);
    expect(p1).not.toBe(p2);
  });

  it("prunes the browser entry only when the LAST page closes", () => {
    const p1 = useTabStore.getState().createBrowserPage(W, "https://one.example");
    const p2 = useTabStore.getState().createBrowserPage(W, "https://two.example");
    useTabStore.getState().closeTab(W, p1);
    expect(mru()).toContain(BROWSER_MRU_KEY);
    useTabStore.getState().closeTab(W, p2);
    expect(mru()).not.toContain(BROWSER_MRU_KEY);
  });
});

describe("tabMruStore — bounded", () => {
  it("stays bounded across heavy churn", () => {
    for (let i = 0; i < 200; i += 1) {
      const id = useTabStore.getState().createTab(W, null);
      if (i % 2 === 0) useTabStore.getState().closeTab(W, id);
    }
    const live = (useTabStore.getState().tabs[W] ?? []).length;
    expect(mru().length).toBeLessThanOrEqual(live + 1);
  });
});

describe("tabMruStore — matches an independent reference model (S6)", () => {
  it("agrees with the model after EVERY command", () => {
    const cmdArb = fc.oneof(
      fc.record({
        tag: fc.constant("activate" as const),
        window: fc.constantFrom(W, "w2"),
        key: fc.constantFrom("a", "b", "c", "d", null),
        origin: fc.constantFrom(...ACTIVATION_ORIGINS),
      }),
      fc.record({
        tag: fc.constant("close" as const),
        window: fc.constantFrom(W, "w2"),
        key: fc.constantFrom("a", "b", "c", "d"),
      }),
      fc.record({ tag: fc.constant("removeWindow" as const), window: fc.constantFrom(W, "w2") }),
    );

    fc.assert(
      fc.property(fc.array(cmdArb, { maxLength: 40 }), (cmds) => {
        useTabStore.setState({ tabs: {}, activeTabId: {}, lastActiveBrowserPageId: {}, untitledCounter: 0 });
        useTabMruStore.getState().reset();

        // FOUR symbols, not three. With three, a close leaves two tabs and the
    // D11 neighbour re-announcement forces the active one to the front — so
    // the surviving order is determined and a 'prune by re-deriving from the
    // live tab list' implementation is indistinguishable from a correct one.
    // Found by mutation, after this model had survived three adversary rounds.
    // Real tabs, so ids are real; the model tracks by the same symbol.
        const idOf: Record<string, Record<string, string>> = { [W]: {}, w2: {} };
        const model: Record<string, { strip: string[]; active: string | null; mru: string[] }> = {
          [W]: { strip: [], active: null, mru: [] },
          w2: { strip: [], active: null, mru: [] },
        };
        for (const w of [W, "w2"]) {
          for (const sym of ["a", "b", "c", "d"]) {
            const id = useTabStore.getState().createTab(w, null);
            idOf[w][sym] = id;
            model[w].strip.push(id);
            model[w].mru = [id, ...model[w].mru.filter((k) => k !== id)];
            model[w].active = id;
          }
        }

        for (const cmd of cmds) {
          const w = cmd.window;
          if (cmd.tag === "activate") {
            const id = cmd.key === null ? null : idOf[w][cmd.key];
            // A generated activate is a BUS ANNOUNCEMENT: it updates `mru` under
            // the origin filter and writes neither `strip` nor `active`.
            notifyTabActivated(w, id, cmd.origin);
            if (cmd.origin === "user" && id && model[w].strip.includes(id)) {
              model[w].mru = [id, ...model[w].mru.filter((k) => k !== id)];
            }
          } else if (cmd.tag === "close") {
            const id = idOf[w][cmd.key];
            const removedIndex = model[w].strip.indexOf(id);
            useTabStore.getState().closeTab(w, id);
            // close of a tab not in `strip` is a TOTAL no-op.
            if (removedIndex !== -1) {
              model[w].strip.splice(removedIndex, 1);
              model[w].mru = model[w].mru.filter((k) => k !== id);
              const remaining = model[w].strip;
              if (remaining.length > 0) {
                const pick =
                  model[w].active === id
                    ? remaining[Math.min(removedIndex, remaining.length - 1)]
                    : model[w].active;
                if (pick) {
                  model[w].active = pick;
                  model[w].mru = [pick, ...model[w].mru.filter((k) => k !== pick)];
                }
              } else {
                model[w].active = null;
              }
            }
          } else {
            useTabStore.getState().removeWindow(w);
            model[w] = { strip: [], active: null, mru: [] };
          }

          for (const win of [W, "w2"]) {
            expect(mru(win)).toEqual(model[win].mru);
          }
        }
      }),
      { numRuns: 120 },
    );
  });
});
