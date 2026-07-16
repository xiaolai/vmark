// WI-P4.2 — injected scroll/key act scripts. On macOS these dispatch SYNTHETIC
// DOM events (SPIKE-3), so a site gating on event.isTrusted ignores them —
// documented, not "fixed". Tested here for the DOM-event behavior.
import { describe, it, expect } from "vitest";
import { buildSnapshotScript } from "./actScript";
import { buildScrollToRefScript, buildScrollByScript, buildKeyScript } from "./interactScript";

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}
/** Execute an injected script with `document`/`window` in scope, as the page would. */
function exec(doc: Document, script: string): unknown {
  const fn = new Function("document", "window", script);
  return JSON.parse(fn(doc, doc.defaultView) as string);
}

interface ActResult {
  found?: boolean;
  scrolled?: boolean;
  dispatched?: boolean;
}

describe("buildScrollToRefScript", () => {
  it("scrolls to the element bound to a ref minted at the same generation", () => {
    const doc = parse(`<button id="a">A</button>`);
    const ref = (exec(doc, buildSnapshotScript(3)) as Array<{ ref: string }>)[0].ref;
    const res = exec(doc, buildScrollToRefScript(ref, 3)) as ActResult;
    expect(res).toEqual({ found: true, scrolled: true });
  });

  it("refuses a stale ref after the generation bumps", () => {
    const doc = parse(`<button id="a">A</button>`);
    const ref = (exec(doc, buildSnapshotScript(3)) as Array<{ ref: string }>)[0].ref;
    const res = exec(doc, buildScrollToRefScript(ref, 4)) as ActResult;
    expect(res).toEqual({ found: false, scrolled: false });
  });
});

describe("buildScrollByScript", () => {
  it("reports scrolled for a delta scroll", () => {
    const doc = parse(`<main>content</main>`);
    const res = exec(doc, buildScrollByScript(400)) as ActResult;
    expect(res.scrolled).toBe(true);
  });
});

describe("buildKeyScript", () => {
  it("dispatches a keydown/keyup to a ref'd element with the given key", () => {
    const doc = parse(`<input id="e" type="text">`);
    const ref = (exec(doc, buildSnapshotScript(1)) as Array<{ ref: string }>)[0].ref;
    const keys: string[] = [];
    doc.getElementById("e")!.addEventListener("keydown", (ev) => keys.push((ev as KeyboardEvent).key));
    const res = exec(doc, buildKeyScript("Enter", ref, 1)) as ActResult;
    expect(res).toEqual({ found: true, dispatched: true });
    expect(keys).toEqual(["Enter"]);
  });

  it("carries modifiers", () => {
    const doc = parse(`<input id="e" type="text">`);
    const ref = (exec(doc, buildSnapshotScript(1)) as Array<{ ref: string }>)[0].ref;
    let seen: KeyboardEvent | undefined;
    doc.getElementById("e")!.addEventListener("keydown", (ev) => (seen = ev as KeyboardEvent));
    exec(doc, buildKeyScript("a", ref, 1, { ctrl: true, shift: true }));
    expect(seen?.ctrlKey).toBe(true);
    expect(seen?.shiftKey).toBe(true);
    expect(seen?.altKey).toBe(false);
  });

  it("dispatches to the active element when no ref is given", () => {
    const doc = parse(`<input id="e" type="text">`);
    (doc.getElementById("e") as HTMLInputElement).focus();
    const res = exec(doc, buildKeyScript("Escape", null, 1)) as ActResult;
    expect(res.dispatched).toBe(true);
  });

  it("refuses a stale ref", () => {
    const doc = parse(`<input id="e" type="text">`);
    const ref = (exec(doc, buildSnapshotScript(1)) as Array<{ ref: string }>)[0].ref;
    const res = exec(doc, buildKeyScript("Enter", ref, 2)) as ActResult;
    expect(res).toEqual({ found: false, dispatched: false });
  });
});
