// WI-AL1.4 — the Source-mode provenance collector: a real CodeMirror view reports every transaction to its tab's session before the store write, a transaction it did not see (a state swap) fails closed as unobserved-transaction, a view created on text the session does not hold attaches uncertified, a hidden view reports nothing, store-to-view syncs are not certified as edits, and a replaced session (save-as) is re-attached uncertified; touching changes in one transaction (multi-cursor, formatting) are composed section by section, so the journal's map matches CodeMirror's own mapPos at the shared boundary.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/utils/debug", () => ({ journalWarn: vi.fn() }));

import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useDocumentStore } from "@/stores/documentStore";
import { freezeUnsavedProvenance } from "../../unsavedProvenance";
import { provenanceSessionFor, startProvenanceSessions } from "../../provenanceSessions";
import { createSourceProvenance, type SourceProvenance } from "../sourceCollector";
import { decodeProvenance } from "../../provenance/codec";

type Breaks = { whole: { reason: string; origin: string } | null };
async function wholeOf(tabId: string, buffer: string) {
  const f = freezeUnsavedProvenance(tabId, buffer)!;
  const named = await f.payload(null);
  expect(named).not.toBeNull();
  f.recorded(named!.basis);
  return (named!.payload as unknown as { body: { breaks: Breaks } }).body.breaks.whole;
}

const store = () => useDocumentStore.getState();
let stop: (() => void) | null = null;
const views: EditorView[] = [];

/** A view wired like SourceEditor: the collector first, then the listener that writes the store. */
function mount(tabId: string, opts: { live?: () => boolean; doc?: string; extra?: Extension } = {}) {
  const live = opts.live ?? (() => true);
  const provenance: SourceProvenance = createSourceProvenance(tabId, live);
  const writer = EditorView.updateListener.of((u) => {
    if (live() && u.docChanged) store().setEditorContent(tabId, u.state.doc.toString());
  });
  const view = new EditorView({
    state: EditorState.create({ doc: opts.doc ?? store().documents[tabId].content, extensions: [provenance.extension, writer, opts.extra ?? []] }),
    parent: document.body,
  });
  provenance.start(view);
  views.push(view);
  return { view, provenance };
}
const type = (view: EditorView, at: number, insert: string) => view.dispatch({ changes: { from: at, insert } });

beforeEach(() => {
  useDocumentStore.setState({ documents: {} });
  store().initDocument("t1", "", null);
  stop = startProvenanceSessions();
});
afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  stop?.();
  stop = null;
});

describe("source collector", () => {
  it("certifies typing (CJK and emoji included) end to end", async () => {
    const { view } = mount("t1");
    type(view, 0, "中文");
    type(view, 2, "😀x");
    view.dispatch({ changes: { from: 0, to: 1 } });
    expect(store().documents.t1.content).toBe("文😀x");
    expect(await wholeOf("t1", "文😀x")).toBeNull();
  });

  it("a transaction with no change (reconfigure, selection) is not a gap", async () => {
    const { view } = mount("t1");
    type(view, 0, "a");
    view.dispatch({ selection: { anchor: 0 } });
    view.dispatch({ effects: [] });
    expect(await wholeOf("t1", "a")).toBeNull();
  });

  it("a delete-and-retype outside the collector is a gap even at equal text", async () => {
    const { view, provenance } = mount("t1");
    type(view, 0, "ab");
    // Re-create the same text behind the collector's back, then edit through it.
    const swapped = EditorState.create({ doc: "ab", extensions: [provenance.extension] });
    view.setState(swapped);
    type(view, 2, "c");
    expect(store().documents.t1.content).toBe("ab"); // the swapped state has no store writer
    expect(await wholeOf("t1", "ab")).toEqual({ reason: "snapshotOnly", origin: "source:unobserved-transaction" });
  });

  it("a state swapped out and back is a gap at once, with no transaction after it", async () => {
    const { view } = mount("t1");
    type(view, 0, "ab");
    const held = view.state;
    view.setState(EditorState.create({ doc: "zz" }));
    view.setState(held); // the very same document object is back
    expect(await wholeOf("t1", "ab")).toEqual({ reason: "snapshotOnly", origin: "source:unobserved-transaction" });
  });

  it("an insert and its delete batched into one update (no net change) is not a gap", async () => {
    const { view } = mount("t1");
    type(view, 0, "ab");
    const insert = view.state.update({ changes: { from: 2, insert: "x" } });
    const remove = insert.state.update({ changes: { from: 2, to: 3 } });
    view.update([insert, remove]);
    expect(view.state.doc.toString()).toBe("ab");
    type(view, 2, "c");
    expect(await wholeOf("t1", "abc")).toBeNull();
  });

  it("reconfiguring a compartment (read-only toggle) is not a gap", async () => {
    const readOnly = new Compartment();
    const { view } = mount("t1", { extra: readOnly.of(EditorState.readOnly.of(false)) });
    type(view, 0, "a");
    view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(true)) });
    view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(false)) });
    type(view, 1, "b");
    expect(await wholeOf("t1", "ab")).toBeNull();
  });

  it("a view created on text the session does not hold attaches uncertified", async () => {
    mount("t1", { doc: "stale" });
    expect(await wholeOf("t1", "")).toEqual({ reason: "snapshotOnly", origin: "source:attach" });
  });

  it("a remount (new view, own start token) stays certified", async () => {
    const first = mount("t1");
    type(first.view, 0, "x");
    first.provenance.stop();
    first.view.destroy();
    const second = mount("t1");
    type(second.view, 1, "y");
    expect(await wholeOf("t1", "xy")).toBeNull();
  });

  it("a hidden view reports nothing, and the show-time sync is not certified as an edit", async () => {
    let live = false;
    const { view } = mount("t1", { live: () => live });
    const s = provenanceSessionFor("t1")!;
    // Another surface (here a second, live view) edits while this one is hidden.
    const other = mount("t1");
    type(other.view, 0, "hello");
    type(view, 0, "zz"); // a hidden-view change the store never sees
    expect(s.text).toBe("hello");
    live = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: store().documents.t1.content } });
    expect(s.text).toBe("hello");
    type(view, 5, "!");
    expect(await wholeOf("t1", "hello!")).toBeNull();
  });

  it("a store write pushed into the view is a catch-up, not an edit", async () => {
    const { view } = mount("t1");
    type(view, 0, "a");
    store().setEditorContent("t1", "b"); // an unannounced write: breaks the window
    view.dispatch({ changes: { from: 0, to: 1, insert: "b" } });
    const s = provenanceSessionFor("t1")!;
    expect(s.text).toBe("b");
    expect(await wholeOf("t1", "b")).toEqual({ reason: "snapshotOnly", origin: "store:unobserved-write" });
    type(view, 1, "c");
    expect(await wholeOf("t1", "bc")).toBeNull();
  });

  it("re-attaches uncertified to a replacement session (save-as)", async () => {
    const { view } = mount("t1");
    store().setFilePath("t1", "/new.md");
    type(view, 0, "q");
    const s = provenanceSessionFor("t1")!;
    expect(s.text).toBe("q");
    const f = s.freeze("q");
    expect(f.touched).toBe(true);
    f.invalidate();
  });

  it("a hidden view does not attach to a replacement session until it is live again", () => {
    let live = false;
    const { view } = mount("t1", { live: () => live });
    store().setFilePath("t1", "/new.md");
    view.dispatch({ effects: [] }); // an unrelated update (a setting) while hidden
    view.dispatch({ selection: { anchor: 0 } });
    const s = provenanceSessionFor("t1")!;
    const hidden = s.freeze("");
    expect(hidden.touched).toBe(false);
    hidden.invalidate();
    live = true;
    type(view, 0, "q");
    const shown = s.freeze("q");
    expect(shown.touched).toBe(true);
    shown.invalidate();
  });

  it("stop() detaches: later transactions report nothing", () => {
    const { view, provenance } = mount("t1");
    provenance.stop();
    provenance.stop();
    type(view, 0, "z");
    expect(provenanceSessionFor("t1")!.text).toBe("z"); // learned from the store write, not the view
  });

  it("no tab id or no service: a no-op collector", () => {
    stop?.();
    stop = null;
    const p = createSourceProvenance(undefined, () => true);
    const view = new EditorView({ state: EditorState.create({ doc: "", extensions: [p.extension] }), parent: document.body });
    views.push(view);
    p.start(view);
    expect(() => type(view, 0, "a")).not.toThrow();
    p.stop();
  });

  it("composes touching changes section by section, matching CodeMirror's mapPos", async () => {
    const { view } = mount("t1");
    type(view, 0, "abcd");
    expect(await wholeOf("t1", "abcd")).toBeNull(); // the next window starts at "abcd"
    const changes = view.state.changes([
      { from: 0, to: 2, insert: "X" },
      { from: 2, to: 4, insert: "Y" },
    ]);
    view.dispatch({ changes });
    const f = freezeUnsavedProvenance("t1", "XY")!;
    const named = await f.payload(null);
    const body = (named!.payload as unknown as { body: unknown }).body;
    const map = decodeProvenance(body);
    f.invalidate();
    for (let p = 0; p <= 4; p++) {
      expect([p, map.L(p), map.R(p)]).toEqual([p, changes.mapPos(p, -1), changes.mapPos(p, 1)]);
    }
  });
});
