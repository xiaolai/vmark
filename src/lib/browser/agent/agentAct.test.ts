// S-03 / S-04 / S-08 / S-10 — act truthfulness, attribute tier (jsdom).
//
// The layout-dependent checks (rects, computed styles, elementFromPoint)
// self-disable where no layout engine exists, so these tests exercise the
// attribute tier of each refusal; `actScript.webkit.test.ts` runs the rendered
// tier against the same shipped bytes in real WebKit.
import { describe, it, expect } from "vitest";
import {
  buildClickScript,
  buildClickByRefScript,
  buildSnapshotScript,
  buildTypeScript,
  buildTypeByRefScript,
} from "./actScript";
import { buildQueryScript } from "./powerScript";

interface ActResult {
  found: boolean;
  clicked?: boolean;
  typed?: boolean;
  reason?: string;
  detail?: string;
  matchedTotal?: number;
  matchedVisible?: number;
  candidates?: Array<{ ref: string; text: string }>;
}
interface Snapshot {
  nodes: Array<{ role: string; name: string; ref: string; upload?: boolean }>;
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}
function exec(doc: Document, script: string): unknown {
  return JSON.parse(new Function("document", script)(doc) as string);
}
/** Record which element ids receive a click. */
function wire(doc: Document): string[] {
  const hits: string[] = [];
  doc.querySelectorAll("[id]").forEach((e) => e.addEventListener("click", () => hits.push(e.id)));
  return hits;
}
/** Mint a ref for the first element matching `selector` at `gen`. */
function refOf(doc: Document, selector: string, gen: number): string {
  const q = exec(doc, buildQueryScript(selector, gen)) as { elements: Array<{ ref: string }> };
  return q.elements[0].ref;
}

describe("ambiguity is refused, never resolved by DOM order (S-03)", () => {
  it("two visible same-name buttons → 'ambiguous' with ref'd candidates, and nothing is clicked", () => {
    const doc = parse(
      `<form class="login"><button id="a">Go</button></form><form class="signup"><button id="b">Go</button></form>`,
    );
    const hits = wire(doc);
    const res = exec(doc, buildClickScript("button", "Go", 4)) as ActResult;
    expect(res).toMatchObject({ found: true, clicked: false, reason: "ambiguous", matchedTotal: 2, matchedVisible: 2 });
    expect(hits).toEqual([]);
    expect(res.candidates).toHaveLength(2);
    expect(res.candidates![0].text.startsWith("button in form.login")).toBe(true);
    expect(res.candidates![1].text.startsWith("button in form.signup")).toBe(true);
    for (const c of res.candidates!) {
      expect(c.ref).toMatch(/^e\d+$/);
      expect(c.text.length).toBeLessThanOrEqual(80);
    }
    // The refs disambiguate: a ref act at the same generation lands on the chosen one.
    const r2 = exec(doc, buildClickByRefScript(res.candidates![1].ref, 4)) as ActResult;
    expect(r2).toEqual({ found: true, clicked: true });
    expect(hits).toEqual(["b"]);
  });

  it("candidates minted WITHOUT a generation reuse the live store, so a prior read's refs stay valid", () => {
    const doc = parse(`<button id="a">Go</button><button id="b">Go</button>`);
    const snap = exec(doc, buildSnapshotScript(7)) as Snapshot;
    const res = exec(doc, buildClickScript("button", "Go")) as ActResult;
    expect(res.reason).toBe("ambiguous");
    expect(res.candidates!.map((c) => c.ref)).toEqual(snap.nodes.map((n) => n.ref));
    expect(exec(doc, buildClickByRefScript(snap.nodes[0].ref, 7)) as ActResult).toEqual({ found: true, clicked: true });
  });

  it("context names an id'd ancestor, and a hostile class token never reaches the text", () => {
    const doc = parse(
      `<div id="hdr"><button>Go</button></div><div class="${"z".repeat(500)} ok"><button>Go</button></div>`,
    );
    const res = exec(doc, buildClickScript("button", "Go", 1)) as ActResult;
    expect(res.candidates![0].text.startsWith("button in div#hdr")).toBe(true);
    expect(res.candidates![1].text.startsWith("button in div.ok")).toBe(true);
    expect(res.candidates![1].text).not.toContain("zzzz");
  });

  it("type refuses ambiguity the same way and mutates nothing", () => {
    const doc = parse(`<input id="x" aria-label="Email"><input id="y" aria-label="Email">`);
    const res = exec(doc, buildTypeScript("textbox", "Email", "a@b.c", 2)) as ActResult;
    expect(res).toMatchObject({ found: true, typed: false, reason: "ambiguous", matchedTotal: 2, matchedVisible: 2 });
    expect(res.candidates).toHaveLength(2);
    expect((doc.getElementById("x") as HTMLInputElement).value).toBe("");
    expect((doc.getElementById("y") as HTMLInputElement).value).toBe("");
    const r2 = exec(doc, buildTypeByRefScript(res.candidates![1].ref, "a@b.c", 2)) as ActResult;
    expect(r2).toEqual({ found: true, typed: true });
    expect((doc.getElementById("y") as HTMLInputElement).value).toBe("a@b.c");
  });

  it("a hidden duplicate does not make a visible singleton ambiguous", () => {
    const doc = parse(`<div hidden><button id="g">Go</button></div><button id="r">Go</button>`);
    const hits = wire(doc);
    const res = exec(doc, buildClickScript("button", "Go")) as ActResult;
    expect(res).toEqual({ found: true, clicked: true, matchedTotal: 2, matchedVisible: 1 });
    expect(hits).toEqual(["r"]);
  });
});

describe("inert subtrees are 'disabled', not 'hidden' (S-04, attribute tier)", () => {
  it("a lone match inside an inert subtree → disabled/inert, and no click", () => {
    const doc = parse(`<div inert><button id="s">Submit</button></div>`);
    const hits = wire(doc);
    const res = exec(doc, buildClickScript("button", "Submit")) as ActResult;
    expect(res).toEqual({
      found: true,
      clicked: false,
      reason: "disabled",
      detail: "inert",
      matchedTotal: 1,
      matchedVisible: 0,
    });
    expect(hits).toEqual([]);
  });

  it("an inert duplicate never competes with the interactable twin", () => {
    const doc = parse(`<div inert><button id="i">Go</button></div><button id="r">Go</button>`);
    const hits = wire(doc);
    const res = exec(doc, buildClickScript("button", "Go")) as ActResult;
    expect(res).toEqual({ found: true, clicked: true, matchedTotal: 2, matchedVisible: 1 });
    expect(hits).toEqual(["r"]);
  });

  it("hidden AND inert reports 'hidden' — the stronger fact wins", () => {
    const doc = parse(`<div inert hidden><button>Go</button></div>`);
    const res = exec(doc, buildClickScript("button", "Go")) as ActResult;
    expect(res).toMatchObject({ found: true, clicked: false, reason: "hidden", matchedVisible: 0 });
  });

  it("ref path: a target made inert since the read → disabled/inert", () => {
    const doc = parse(`<div id="wrap"><button id="b">Go</button></div>`);
    const ref = (exec(doc, buildSnapshotScript(3)) as Snapshot).nodes[0].ref;
    doc.getElementById("wrap")!.setAttribute("inert", "");
    const hits = wire(doc);
    expect(exec(doc, buildClickByRefScript(ref, 3))).toEqual({ found: true, clicked: false, reason: "disabled", detail: "inert" });
    expect(hits).toEqual([]);
  });

  it("type into an inert field → disabled/inert", () => {
    const doc = parse(`<div inert><input aria-label="Email"></div>`);
    const res = exec(doc, buildTypeScript("textbox", "Email", "x")) as ActResult;
    expect(res).toMatchObject({ found: true, typed: false, reason: "disabled", detail: "inert" });
    expect(doc.querySelector("input")!.value).toBe("");
  });
});

describe("type verifies the value the engine kept (S-08)", () => {
  function counting(doc: Document, sel: string): { input: number; change: number } {
    const counts = { input: 0, change: 0 };
    const target = doc.querySelector(sel)!;
    target.addEventListener("input", () => (counts.input += 1));
    target.addEventListener("change", () => (counts.change += 1));
    return counts;
  }

  it("a number field rejects letters: 'rejected-value', prior value restored, no events fired", () => {
    const doc = parse(`<input type="number" aria-label="Qty" value="5">`);
    const counts = counting(doc, "input");
    const res = exec(doc, buildTypeScript("spinbutton", "Qty", "abc")) as ActResult;
    expect(res).toEqual({ found: true, typed: false, reason: "rejected-value", matchedTotal: 1, matchedVisible: 1 });
    expect(doc.querySelector("input")!.value).toBe("5");
    expect(counts).toEqual({ input: 0, change: 0 });
  });

  it("a single-line field rejects a newline the engine strips", () => {
    const doc = parse(`<input type="text" aria-label="Name" value="old">`);
    const res = exec(doc, buildTypeScript("textbox", "Name", "a\nb")) as ActResult;
    expect(res).toMatchObject({ typed: false, reason: "rejected-value" });
    expect(doc.querySelector("input")!.value).toBe("old");
  });

  it("a textarea accepts multi-line text, CRLF normalised the way the API value is", () => {
    const doc = parse(`<textarea aria-label="Body"></textarea>`);
    const res = exec(doc, buildTypeScript("textbox", "Body", "a\r\nb")) as ActResult;
    expect(res.typed).toBe(true);
    expect(doc.querySelector("textarea")!.value).toBe("a\nb");
  });

  it("a value the engine keeps verbatim is typed and fires input + change", () => {
    const doc = parse(`<input type="number" aria-label="Qty">`);
    const counts = counting(doc, "input");
    expect((exec(doc, buildTypeScript("spinbutton", "Qty", "42")) as ActResult).typed).toBe(true);
    expect(doc.querySelector("input")!.value).toBe("42");
    expect(counts).toEqual({ input: 1, change: 1 });
  });

  it.each(["checkbox", "radio", "submit", "button", "reset", "image"])(
    "an input type=%s is not a text target: 'not-editable', value untouched",
    (type) => {
      const doc = parse(`<input type="${type}" aria-label="T" value="v">`);
      const role = type === "checkbox" || type === "radio" ? type : "button";
      const res = exec(doc, buildTypeScript(role, "T", "x")) as ActResult;
      expect(res).toMatchObject({ found: true, typed: false, reason: "not-editable" });
      expect(doc.querySelector("input")!.value).toBe("v");
    },
  );

  function editable(doc: Document): HTMLElement {
    const el = doc.querySelector("[contenteditable]") as HTMLElement;
    if (!el.isContentEditable) Object.defineProperty(el, "isContentEditable", { configurable: true, get: () => true });
    return el;
  }

  it("contenteditable: a cancelable beforeinput (insertText, data) precedes the mutation; input is an InputEvent", () => {
    const doc = parse(`<div role="textbox" aria-label="Body" contenteditable="true">old</div>`);
    const el = editable(doc);
    const seen: string[] = [];
    el.addEventListener("beforeinput", (ev) => {
      const ie = ev as InputEvent;
      seen.push(`beforeinput:${ie.inputType}:${ie.data}:${ie.cancelable}:${el.textContent}`);
    });
    el.addEventListener("input", (ev) => {
      seen.push(`input:${ev instanceof InputEvent ? (ev as InputEvent).inputType : "plain"}:${el.textContent}`);
    });
    const res = exec(doc, buildTypeScript("textbox", "Body", "new")) as ActResult;
    expect(res).toMatchObject({ found: true, typed: true });
    expect(seen).toEqual(["beforeinput:insertText:new:true:old", "input:insertText:new"]);
  });

  it("contenteditable: an editor that cancels beforeinput owns the insertion — no visible change is a refusal", () => {
    const doc = parse(`<div role="textbox" aria-label="Body" contenteditable="true">model</div>`);
    const el = editable(doc);
    let inputs = 0;
    el.addEventListener("beforeinput", (ev) => ev.preventDefault());
    el.addEventListener("input", () => (inputs += 1));
    const res = exec(doc, buildTypeScript("textbox", "Body", "new")) as ActResult;
    // The editor cancelled the insertion and changed nothing visible: that is a
    // refusal now, not a typed value (audit 2026-09-03 round 1).
    expect(res).toMatchObject({ found: true, typed: false, reason: "rejected-value", detail: "editor-cancelled" });
    expect(el.textContent).toBe("model");
    expect(inputs).toBe(0);
  });
});

describe("uploads are refused (S-10)", () => {
  it("click on a file input → 'upload', nothing dispatched", () => {
    const doc = parse(`<input id="f" type="file" aria-label="Attachment">`);
    const hits = wire(doc);
    const res = exec(doc, buildClickScript("textbox", "Attachment")) as ActResult;
    expect(res).toEqual({ found: true, clicked: false, reason: "upload", matchedTotal: 1, matchedVisible: 1 });
    expect(hits).toEqual([]);
  });

  it("type into a file input → 'upload'", () => {
    const doc = parse(`<input type="file" aria-label="Attachment">`);
    expect(exec(doc, buildTypeScript("textbox", "Attachment", "/etc/passwd"))).toMatchObject({
      found: true,
      typed: false,
      reason: "upload",
    });
  });

  it("click on a label[for] that resolves to a file input → 'upload'", () => {
    const doc = parse(`<label id="l" for="f">Choose</label><input id="f" type="file">`);
    const hits = wire(doc);
    expect(exec(doc, buildClickByRefScript(refOf(doc, "label", 1), 1))).toEqual({ found: true, clicked: false, reason: "upload" });
    expect(hits).toEqual([]);
  });

  it("click on a non-interactive element inside a label wrapping a file input → 'upload'", () => {
    const doc = parse(`<label><span id="s">Choose</span><input type="file"></label>`);
    const hits = wire(doc);
    expect(exec(doc, buildClickByRefScript(refOf(doc, "span", 1), 1))).toEqual({ found: true, clicked: false, reason: "upload" });
    expect(hits).toEqual([]);
  });

  it("a real button inside such a label is still clickable — interactive content never activates the label", () => {
    const doc = parse(`<label><button id="b">Help</button><input type="file"></label>`);
    const hits = wire(doc);
    expect(exec(doc, buildClickScript("button", "Help"))).toMatchObject({ clicked: true });
    expect(hits).toEqual(["b"]);
  });

  it("a label for a text input is not an upload", () => {
    const doc = parse(`<label for="t">Name</label><input id="t" type="text">`);
    expect(exec(doc, buildClickByRefScript(refOf(doc, "label", 1), 1))).toEqual({ found: true, clicked: true });
  });

  it("snapshot nodes for file inputs carry upload:true, others do not", () => {
    const doc = parse(`<input type="file" aria-label="Attachment"><input type="text" aria-label="Name">`);
    const nodes = (exec(doc, buildSnapshotScript()) as Snapshot).nodes;
    expect(nodes.find((n) => n.name === "Attachment")?.upload).toBe(true);
    expect("upload" in nodes.find((n) => n.name === "Name")!).toBe(false);
  });
});
