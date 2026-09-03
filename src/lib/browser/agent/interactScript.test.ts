// WI-P4.2 / S-07 — injected scroll/key act scripts. On macOS these dispatch
// SYNTHETIC DOM events (SPIKE-3), so a site gating on event.isTrusted ignores
// them — documented, not "fixed". Tested here for the DOM-event behavior, and
// (S-07) for the legacy key fields and the emulated default actions a page's
// own handlers would otherwise never see from a synthetic key.
import { describe, it, expect, beforeEach } from "vitest";
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
function firstRef(doc: Document, gen: number): string {
  return (exec(doc, buildSnapshotScript(gen)) as { nodes: Array<{ ref: string }> }).nodes[0].ref;
}

interface ActResult {
  found?: boolean;
  scrolled?: boolean;
  dispatched?: boolean;
  defaultAction?: string | null;
}

describe("buildScrollToRefScript", () => {
  it("scrolls to the element bound to a ref minted at the same generation", () => {
    const doc = parse(`<button id="a">A</button>`);
    const res = exec(doc, buildScrollToRefScript(firstRef(doc, 3), 3)) as ActResult;
    expect(res).toEqual({ found: true, scrolled: true });
  });

  it("refuses a stale ref after the generation bumps", () => {
    const doc = parse(`<button id="a">A</button>`);
    const res = exec(doc, buildScrollToRefScript(firstRef(doc, 3), 4)) as ActResult;
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
  it("dispatches keydown/keyup to a ref'd element with the given key", () => {
    const doc = parse(`<input id="e" type="text">`);
    const ref = firstRef(doc, 1);
    const keys: string[] = [];
    doc.getElementById("e")!.addEventListener("keydown", (ev) => keys.push((ev as KeyboardEvent).key));
    const res = exec(doc, buildKeyScript("Enter", ref, 1)) as ActResult;
    expect(res).toEqual({ found: true, dispatched: true, defaultAction: null });
    expect(keys).toEqual(["Enter"]);
  });

  it("carries modifiers", () => {
    const doc = parse(`<input id="e" type="text">`);
    const ref = firstRef(doc, 1);
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
    const ref = firstRef(doc, 1);
    const res = exec(doc, buildKeyScript("Enter", ref, 2)) as ActResult;
    expect(res).toEqual({ found: false, dispatched: false });
  });
});

// S-07: a synthetic KeyboardEvent carried only `key`, so a page switching on the
// legacy `keyCode`/`which` (still the majority of hand-written handlers) saw 0,
// and nothing emulated the default action a real Enter or Tab performs.
describe("key events carry key, code and the legacy keyCode/which (S-07)", () => {
  type Seen = { type: string; key: string; code: string; keyCode: number; which: number };

  function record(doc: Document, sel: string): Seen[] {
    const seen: Seen[] = [];
    const el = doc.querySelector(sel)!;
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.addEventListener(type, (ev) => {
        const k = ev as KeyboardEvent;
        seen.push({ type, key: k.key, code: k.code, keyCode: k.keyCode, which: k.which });
      });
    }
    return seen;
  }

  it.each([
    ["Enter", "Enter", 13],
    ["Escape", "Escape", 27],
    ["Tab", "Tab", 9],
    ["Backspace", "Backspace", 8],
    ["Delete", "Delete", 46],
    ["ArrowLeft", "ArrowLeft", 37],
    ["ArrowUp", "ArrowUp", 38],
    ["ArrowRight", "ArrowRight", 39],
    ["ArrowDown", "ArrowDown", 40],
    [" ", "Space", 32],
    ["a", "KeyA", 65],
    ["Z", "KeyZ", 90],
    ["7", "Digit7", 55],
  ])("%j → code %s, keyCode %i", (key, code, keyCode) => {
    const doc = parse(`<input id="e" type="text">`);
    const seen = record(doc, "#e");
    exec(doc, buildKeyScript(key, firstRef(doc, 1), 1));
    const down = seen.find((s) => s.type === "keydown")!;
    expect(down).toEqual({ type: "keydown", key, code, keyCode, which: keyCode });
    const up = seen.find((s) => s.type === "keyup")!;
    expect(up).toMatchObject({ key, code, keyCode, which: keyCode });
  });

  it("'Space' is accepted as an alias of ' '", () => {
    const doc = parse(`<input id="e" type="text">`);
    const seen = record(doc, "#e");
    exec(doc, buildKeyScript("Space", firstRef(doc, 1), 1));
    expect(seen[0]).toMatchObject({ key: " ", code: "Space", keyCode: 32 });
  });

  it("fires keypress for character keys and Enter, not for Escape/Tab/arrows/Backspace/Delete", () => {
    for (const [key, expectPress] of [["a", true], ["Enter", true], [" ", true], ["Escape", false], ["Tab", false], ["ArrowDown", false], ["Backspace", false], ["Delete", false]] as const) {
      const doc = parse(`<input id="e" type="text">`);
      const seen = record(doc, "#e");
      exec(doc, buildKeyScript(key, firstRef(doc, 1), 1));
      expect(seen.map((s) => s.type)).toEqual(expectPress ? ["keydown", "keypress", "keyup"] : ["keydown", "keyup"]);
    }
  });

  it("a prevented keydown suppresses keypress (as engines do) but keyup still fires", () => {
    const doc = parse(`<input id="e" type="text">`);
    const seen = record(doc, "#e");
    doc.getElementById("e")!.addEventListener("keydown", (ev) => ev.preventDefault());
    exec(doc, buildKeyScript("a", firstRef(doc, 1), 1));
    expect(seen.map((s) => s.type)).toEqual(["keydown", "keyup"]);
  });
});

describe("Enter emulates implicit form submission (S-07)", () => {
  function submitted(doc: Document): Array<Element | null> {
    const out: Array<Element | null> = [];
    doc.querySelectorAll("form").forEach((f) =>
      f.addEventListener("submit", (ev) => {
        ev.preventDefault(); // jsdom implements no navigation; the event is the observable
        out.push((ev as SubmitEvent).submitter);
      }),
    );
    return out;
  }
  function refOf(doc: Document, id: string, gen: number): string {
    const snap = exec(doc, buildSnapshotScript(gen)) as { nodes: Array<{ ref: string; name: string }> };
    return snap.nodes.find((n) => n.name === id)!.ref;
  }

  it("Enter on a text input in a form with a submit button → requestSubmit with that button as submitter", () => {
    const doc = parse(`<form><input aria-label="q" type="text"><button id="go" type="submit">Go</button></form>`);
    const subs = submitted(doc);
    const res = exec(doc, buildKeyScript("Enter", refOf(doc, "q", 1), 1)) as ActResult;
    expect(res).toEqual({ found: true, dispatched: true, defaultAction: "submitted" });
    expect(subs).toEqual([doc.getElementById("go")]);
  });

  it("the default button is the FIRST submit control in tree order, whatever its tag", () => {
    const doc = parse(
      `<form><input aria-label="q"><button type="button">Not me</button><input id="s" type="submit" value="Send"><button type="submit">Later</button></form>`,
    );
    const subs = submitted(doc);
    exec(doc, buildKeyScript("Enter", refOf(doc, "q", 1), 1));
    expect(subs).toEqual([doc.getElementById("s")]);
  });

  it("a prevented keydown means no submission", () => {
    const doc = parse(`<form><input aria-label="q"><button type="submit">Go</button></form>`);
    const subs = submitted(doc);
    doc.querySelector("input")!.addEventListener("keydown", (ev) => ev.preventDefault());
    const res = exec(doc, buildKeyScript("Enter", refOf(doc, "q", 1), 1)) as ActResult;
    expect(res.defaultAction).toBeNull();
    expect(subs).toEqual([]);
  });

  it("a disabled default button blocks implicit submission", () => {
    const doc = parse(`<form><input aria-label="q"><button type="submit" disabled>Go</button></form>`);
    const subs = submitted(doc);
    expect((exec(doc, buildKeyScript("Enter", refOf(doc, "q", 1), 1)) as ActResult).defaultAction).toBeNull();
    expect(subs).toEqual([]);
  });

  it("with no submit button, a single text field still submits (submitter null); two fields do not", () => {
    const one = parse(`<form><input aria-label="q"></form>`);
    const subsOne = submitted(one);
    expect((exec(one, buildKeyScript("Enter", refOf(one, "q", 1), 1)) as ActResult).defaultAction).toBe("submitted");
    expect(subsOne).toEqual([null]);

    const two = parse(`<form><input aria-label="q"><input aria-label="r" type="email"></form>`);
    const subsTwo = submitted(two);
    expect((exec(two, buildKeyScript("Enter", refOf(two, "q", 1), 1)) as ActResult).defaultAction).toBeNull();
    expect(subsTwo).toEqual([]);
  });

  it("Enter in a select inside a form submits; in a textarea it does not; outside a form it does not", () => {
    const sel = parse(`<form><select aria-label="c"><option>x</option></select><button type="submit">Go</button></form>`);
    const subsSel = submitted(sel);
    expect((exec(sel, buildKeyScript("Enter", refOf(sel, "c", 1), 1)) as ActResult).defaultAction).toBe("submitted");
    expect(subsSel).toHaveLength(1);

    const ta = parse(`<form><textarea aria-label="t"></textarea><button type="submit">Go</button></form>`);
    const subsTa = submitted(ta);
    expect((exec(ta, buildKeyScript("Enter", refOf(ta, "t", 1), 1)) as ActResult).defaultAction).toBeNull();
    expect(subsTa).toEqual([]);

    const loose = parse(`<input aria-label="q">`);
    expect((exec(loose, buildKeyScript("Enter", refOf(loose, "q", 1), 1)) as ActResult).defaultAction).toBeNull();
  });

  it("Shift+Enter is not a submission", () => {
    const doc = parse(`<form><input aria-label="q"><button type="submit">Go</button></form>`);
    const subs = submitted(doc);
    expect((exec(doc, buildKeyScript("Enter", refOf(doc, "q", 1), 1, { shift: true })) as ActResult).defaultAction).toBeNull();
    expect(subs).toEqual([]);
  });
});

describe("Tab emulates focus movement (S-07)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete (document as unknown as { __vmarkRefStore?: unknown }).__vmarkRefStore;
  });

  function run(script: string): ActResult {
    return JSON.parse(new Function("document", "window", script)(document, window) as string) as ActResult;
  }
  function focusedId(): string {
    return document.activeElement?.id ?? "";
  }

  it("Tab moves focus to the next tabbable element, skipping disabled, hidden and tabindex=-1", () => {
    document.body.innerHTML =
      `<input id="a"><button id="skip1" disabled>x</button><a id="skip2">no href</a>` +
      `<div hidden><input id="skip3"></div><input id="skip4" tabindex="-1"><a id="b" href="/x">link</a>`;
    document.getElementById("a")!.focus();
    const res = run(buildKeyScript("Tab", null, 1));
    expect(res).toEqual({ found: true, dispatched: true, defaultAction: "focus-moved" });
    expect(focusedId()).toBe("b");
  });

  it("a radio group is scoped to its tree root: a same-named radio in a shadow root is its own stop (#116)", () => {
    document.body.innerHTML = `<input type="radio" name="g" id="r1"><div id="host"></div><input id="after">`;
    const host = document.getElementById("host")!;
    host.attachShadow({ mode: "open" }).innerHTML = `<input type="radio" name="g" id="r2">`;
    document.getElementById("r1")!.focus();
    const res = run(buildKeyScript("Tab", null, 1));
    expect(res.defaultAction).toBe("focus-moved");
    expect(host.shadowRoot!.activeElement?.id).toBe("r2");
  });

  it("Shift+Tab moves focus backwards", () => {
    document.body.innerHTML = `<input id="a"><input id="b">`;
    document.getElementById("b")!.focus();
    const res = run(buildKeyScript("Tab", null, 1, { shift: true }));
    expect(res.defaultAction).toBe("focus-moved");
    expect(focusedId()).toBe("a");
  });

  it("positive tabindex comes first in tab order, then document order", () => {
    document.body.innerHTML = `<input id="a"><input id="b" tabindex="2"><input id="c" tabindex="1">`;
    document.getElementById("c")!.focus();
    run(buildKeyScript("Tab", null, 1));
    expect(focusedId()).toBe("b");
    run(buildKeyScript("Tab", null, 1));
    expect(focusedId()).toBe("a");
  });

  it("wraps from the last element to the first", () => {
    document.body.innerHTML = `<input id="a"><input id="b">`;
    document.getElementById("b")!.focus();
    run(buildKeyScript("Tab", null, 1));
    expect(focusedId()).toBe("a");
  });

  it("a prevented keydown leaves focus alone and reports no default action", () => {
    document.body.innerHTML = `<input id="a"><input id="b">`;
    document.getElementById("a")!.focus();
    document.getElementById("a")!.addEventListener("keydown", (ev) => ev.preventDefault());
    const res = run(buildKeyScript("Tab", null, 1));
    expect(res.defaultAction).toBeNull();
    expect(focusedId()).toBe("a");
  });

  it("with nothing tabbable there is nowhere to go", () => {
    document.body.innerHTML = `<p>text</p>`;
    const res = run(buildKeyScript("Tab", null, 1));
    expect(res).toEqual({ found: true, dispatched: true, defaultAction: null });
  });
});
