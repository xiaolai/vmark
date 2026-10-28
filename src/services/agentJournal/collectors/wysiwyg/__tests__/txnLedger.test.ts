// WI-AL1.4 — The WYSIWYG transaction ledger: it records every applied transaction under its own sequence, chains a boundary to the current state only across continuous observation, reports each gap (a fork, an installed state it did not produce, a plugin-view attachment after the start, a foreign state at detach) to its listener at once, and holds its declared budgets (edges, retained step maps, replaced ranges, range mappings within one transaction) by dropping the log into a chain-cap, never by truncating it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, Plugin, type Transaction } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { Step, StepMap, StepResult } from "@tiptap/pm/transform";
import { MAX_RANGE_MAPPINGS } from "../pmSteps";
import { CHAIN_CAP, MAX_RETAINED_RANGES, MAX_RETAINED_STEPS, TxnLedger, observerPlugin, type GapReason } from "../txnLedger";

const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*", toDOM: () => ["p", 0] }, text: {} } });

class OpaqueStep extends Step {
  override apply(doc: Parameters<Step["apply"]>[0]) { return StepResult.ok(doc.type.create(doc.attrs, doc.content)); }
  override invert() { return this; }
  override map() { return this; }
  override getMap() { return StepMap.empty; }
  override toJSON() { return { stepType: "opaqueForTest" }; }
}

const views: EditorView[] = [];
afterEach(() => { for (const v of views.splice(0)) v.destroy(); });

function setup(budgets?: ConstructorParameters<typeof TxnLedger>[0]) {
  const ledger = new TxnLedger(budgets);
  const gaps: GapReason[] = [];
  const view = new EditorView(document.createElement("div"), {
    state: EditorState.create({ schema, plugins: [observerPlugin(ledger)] }),
  });
  views.push(view);
  ledger.onGap = (r) => gaps.push(r);
  const type = (text: string, at = 1) => view.dispatch(view.state.tr.insertText(text, at));
  return { ledger, view, gaps, type };
}

describe("TxnLedger", () => {
  it("budgets are declared", () => {
    expect(CHAIN_CAP).toBe(10_000);
    expect(MAX_RETAINED_STEPS).toBe(16_384);
    expect(MAX_RETAINED_RANGES).toBe(MAX_RETAINED_STEPS);
    expect(MAX_RANGE_MAPPINGS).toBe(2 ** 23);
  });

  it("a transaction whose touched ranges would cost past the mapping budget is a chain-cap, not a quadratic walk", () => {
    // Five steps at disjoint places: carrying the earlier ranges through the later maps costs 0 + 1 + 2 + 3 + 4 = 10.
    const disjoint = (view: EditorView) => {
      const tr = view.state.tr.insertText("abcdefghijklmnop", 1);
      for (const at of [16, 12, 8, 4]) tr.insertText("x", at);
      return tr;
    };
    const within = setup({ maxRangeMappings: 10 });
    const fromWithin = within.ledger.boundary(within.view.state);
    within.view.dispatch(disjoint(within.view));
    expect(within.ledger.chain(fromWithin, within.view.state).ok).toBe(true);
    const over = setup({ maxRangeMappings: 9 });
    const fromOver = over.ledger.boundary(over.view.state);
    over.view.dispatch(disjoint(over.view));
    expect(over.ledger.chain(fromOver, over.view.state)).toMatchObject({ ok: false, reason: "chain-cap" });
    // The cap dropped the log: after a flush consumes it, the next window chains exactly its own edge.
    const head = over.ledger.boundary(over.view.state);
    over.ledger.forget(head.cursor);
    over.type("y");
    const next = over.ledger.chain(head, over.view.state);
    expect(next.ok && next.edges.length).toBe(1);
  });

  it("the production start (first attachment on the init state) is not a gap", () => {
    const { gaps, ledger, view, type } = setup();
    expect(gaps).toEqual([]);
    const from = ledger.boundary(view.state);
    type("a");
    expect(ledger.chain(from, view.state).ok).toBe(true);
  });

  it("chains every observed transaction from a boundary to the current state", () => {
    const { ledger, view, type, gaps } = setup();
    const from = ledger.boundary(view.state);
    type("ab");
    type("中😀", 2);
    const chain = ledger.chain(from, view.state);
    expect(chain.ok && chain.edges.length).toBe(2);
    expect(gaps).toEqual([]);
  });

  it("a selection-only transaction records no edge", () => {
    const { ledger, view, type } = setup();
    type("ab");
    const from = ledger.boundary(view.state);
    view.dispatch(view.state.tr.setMeta("x", 1));
    const chain = ledger.chain(from, view.state);
    expect(chain.ok && chain.edges).toEqual([]);
  });

  it("a fork (a transaction applied to an older state) is a gap, reported at once", () => {
    const { ledger, view, type, gaps } = setup();
    const old = view.state;
    const from = ledger.boundary(view.state);
    type("a");
    old.apply(old.tr.insertText("z", 1));
    expect(gaps).toEqual(["fork"]);
    expect(ledger.chain(from, view.state)).toMatchObject({ ok: false, reason: "unobserved-transaction" });
  });

  it("installing a state the ledger did not produce last is a gap", () => {
    const { ledger, view, type, gaps } = setup();
    const old = view.state;
    type("a");
    view.updateState(old);
    expect(gaps).toEqual(["install"]);
    expect(ledger.chain(ledger.boundary(view.state), view.state)).toMatchObject({ ok: false });
  });

  it("a plugin added while live rebuilds the plugin views: an attach gap", () => {
    const { view, gaps } = setup();
    view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, new Plugin({})] }));
    expect(gaps).toContain("attach");
  });

  it("a state without the observer at detach is a gap", () => {
    const { view, gaps } = setup();
    view.updateState(EditorState.create({ schema }));
    expect(gaps).toContain("detach");
  });

  it("a boundary already consumed (forget) no longer chains; later edges stay", () => {
    const { ledger, view, type } = setup();
    const a = ledger.boundary(view.state);
    type("a");
    const b = ledger.boundary(view.state);
    ledger.forget(b.cursor);
    type("b");
    expect(ledger.chain(a, view.state)).toMatchObject({ ok: false, reason: "unobserved-transaction" });
    const chain = ledger.chain(b, view.state);
    expect(chain.ok && chain.edges.length).toBe(1);
  });

  it("an unknown step class is recorded as such", () => {
    const { ledger, view } = setup();
    const from = ledger.boundary(view.state);
    view.dispatch(view.state.tr.step(new OpaqueStep()));
    const chain = ledger.chain(from, view.state);
    expect(chain.ok && chain.edges[0].unknownSteps).toEqual(["OpaqueStep"]);
  });

  it.each([
    ["edges", { chainCap: 2 }],
    ["retained step maps", { maxSteps: 2 }],
    ["replaced ranges", { maxRanges: 2 }],
  ] as const)("past its %s budget the log is dropped into a chain-cap, never truncated", (_name, budgets) => {
    const { ledger, view, type } = setup(budgets);
    const from = ledger.boundary(view.state);
    type("a");
    type("b");
    type("c");
    expect(ledger.chain(from, view.state)).toMatchObject({ ok: false, reason: "chain-cap" });
    // A flush consumes the capped stretch; the cap dropped the log and its
    // counts, so the next window chains a full budget of its own edges.
    const head = ledger.boundary(view.state);
    ledger.forget(head.cursor);
    type("d");
    type("e");
    const next = ledger.chain(head, view.state);
    expect(next.ok && next.edges.length).toBe(2);
  });

  it.each([
    ["retained step maps", { maxSteps: 2 }],
    ["replaced ranges", { maxRanges: 2 }],
  ] as const)("one transaction past its %s budget on its own drops the log into a chain-cap", (_name, budgets) => {
    const { ledger, view } = setup(budgets);
    const from = ledger.boundary(view.state);
    view.dispatch(view.state.tr.insertText("a", 1).insertText("b", 2).insertText("c", 3));
    expect(ledger.chain(from, view.state)).toMatchObject({ ok: false, reason: "chain-cap" });
  });

  it("a boundary from another ledger is refused loudly", () => {
    const one = setup();
    const two = setup();
    expect(() => one.ledger.chain(two.ledger.boundary(two.view.state), one.view.state)).toThrow(/another observer/);
  });

  it("a listener that throws does not stop recording", () => {
    const { ledger, view, type } = setup();
    ledger.onGap = vi.fn(() => { throw new Error("boom"); });
    const old = view.state;
    type("a");
    expect(() => old.apply(old.tr.insertText("z", 1))).not.toThrow();
    expect(ledger.onGap).toHaveBeenCalledOnce();
  });

  it("a transaction carrying no step and an appended transaction are both observed", () => {
    const ledger = new TxnLedger();
    const append = new Plugin({
      appendTransaction: (trs: readonly Transaction[], _o, state) =>
        trs.some((t) => t.docChanged) && !state.doc.textContent.endsWith("!") ? state.tr.insertText("!", state.doc.content.size - 1) : null,
    });
    const view = new EditorView(document.createElement("div"), { state: EditorState.create({ schema, plugins: [observerPlugin(ledger), append] }) });
    views.push(view);
    const from = ledger.boundary(view.state);
    view.dispatch(view.state.tr.insertText("a", 1));
    const chain = ledger.chain(from, view.state);
    expect(view.state.doc.textContent).toBe("a!");
    expect(chain.ok && chain.edges.length).toBe(2);
  });
});
