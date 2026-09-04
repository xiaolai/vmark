// WI-2.3 — injected act scripts: snapshot / click / type by role+name, run via eval
import { describe, it, expect } from "vitest";
import {
  buildSnapshotScript,
  buildClickScript,
  buildTypeScript,
  buildClickByRefScript,
  buildTypeByRefScript,
  buildWaitConditionScript,
} from "./actScript";
import { ariaSnapshot } from "./aria";

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}

/** Execute a generated agent script against a document (as the page would). */
function exec(doc: Document, script: string): unknown {
  // The script body ends with `return JSON.stringify(...)`, mirroring how the
  // driver's callAsyncJavaScript evaluates it with `document` in scope.
  const fn = new Function("document", script);
  return JSON.parse(fn(doc) as string);
}

/** Execute a generated agent script against an HTML fixture (as the page would). */
function run(html: string, script: string): unknown {
  return exec(parse(html), script);
}

interface SnapNode {
  role: string;
  name: string;
  ref: string;
}

/** The snapshot's nodes (the script returns `{nodes, truncated, unreachable}` — S-05). */
function nodes(doc: Document, gen = 0): SnapNode[] {
  return (exec(doc, buildSnapshotScript(gen)) as { nodes: SnapNode[] }).nodes;
}

interface ActResult {
  found: boolean;
  clicked?: boolean;
  typed?: boolean;
  reason?: string;
  by?: string;
  matchedTotal?: number;
  matchedVisible?: number;
}

describe("buildSnapshotScript", () => {
  it("extracts interactive/structural elements with role + name", () => {
    const snap = nodes(parse(`<h1>Welcome</h1><button>Publish</button><a href="/x">More</a><p>ignored</p>`));
    const byRole = Object.fromEntries(snap.map((n) => [n.role, n.name]));
    expect(byRole.heading).toBe("Welcome");
    expect(byRole.button).toBe("Publish");
    expect(byRole.link).toBe("More");
    expect(snap.some((n) => n.role === "generic")).toBe(false);
  });

  it("stamps each snapshot node with a ref (WI-P2.1)", () => {
    const snap = nodes(parse(`<button>Publish</button><a href="/x">More</a>`));
    expect(snap.length).toBeGreaterThan(0);
    expect(snap.every((n) => /^e\d+$/.test(n.ref))).toBe(true);
  });
});

// The injected library is a standalone copy of `aria.ts` (it must run in the page
// with no bundler). These tests are the contract that keeps the copy honest: the
// two implementations must perceive an identical page identically. A drift here
// means the AI's unit-tested view and its real view have diverged.
describe("parity with aria.ts", () => {
  const FIXTURE = `
    <nav><a href="/">Home</a><a>no href</a></nav>
    <main>
      <h1>Title</h1>
      <h3 id="sub">Sub</h3>
      <div role="heading" aria-level="5">Custom</div>
      <div role="presentation">decoration</div>
      <div role="button link" title="Multi token">t</div>
      <p id="lbl">Save changes</p>
      <button aria-labelledby="lbl">x</button>
      <p id="lbl2">Referenced name</p>
      <button aria-labelledby="lbl2" aria-label="Direct name">combined</button>
      <button disabled>Disabled</button>
      <button aria-label="Close   dialog">x</button>
      <fieldset disabled><button>In fieldset</button></fieldset>
      <label for="e">Email</label><input id="e" type="text">
      <label>Wrapped <input type="password"></label>
      <input type="submit" value="Send it">
      <input type="image" src="/go.png" alt="Go">
      <input type="number" aria-label="Qty">
      <input type="search" aria-label="Find">
      <input type="range" aria-label="Volume">
      <input type="hidden" value="csrf">
      <input type="checkbox" checked aria-label="Agree">
      <input type="radio" aria-label="Pick">
      <div role="checkbox" aria-checked="true" aria-label="Terms"></div>
      <select aria-label="Country"></select>
      <select multiple aria-label="Tags"></select>
      <textarea placeholder="Say  something"></textarea>
      <img src="/x.png" alt="Company  logo">
      <div hidden><button>Ghost</button></div>
      <div aria-hidden="true"><h2>Ghost heading</h2></div>
      <div style="display: none"><button>Ghost css</button></div>
    </main>`;

  it("produces an identical snapshot (role, name, level, checked, disabled) for the same page", () => {
    const doc = parse(FIXTURE);
    const injected = nodes(doc);
    expect(injected).toEqual(ariaSnapshot(doc.body));
  });

  it("agrees on the live checked state after interaction", () => {
    const doc = parse(`<input type="checkbox" checked aria-label="Agree">`);
    (doc.querySelector("input") as HTMLInputElement).checked = false;
    expect(nodes(doc)).toEqual(ariaSnapshot(doc.body));
  });
});

describe("act by ref (WI-P2.2)", () => {
  it("clicks the element bound to a ref minted by a snapshot at the same generation", () => {
    const doc = parse(`<button id="a">One</button><button id="b">Two</button>`);
    const snap = nodes(doc, 5);
    const two = snap.find((n) => n.name === "Two")!;
    let clicked = "";
    doc.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => (clicked = b.id)));
    const res = exec(doc, buildClickByRefScript(two.ref, 5)) as ActResult;
    expect(res).toEqual({ found: true, clicked: true, matchedTotal: 1, matchedVisible: 1 });
    expect(clicked).toBe("b");
  });

  it("types into the field bound to a ref", () => {
    const doc = parse(`<label for="e">Email</label><input id="e" type="text">`);
    const snap = nodes(doc, 1);
    const field = snap.find((n) => n.role === "textbox")!;
    const res = exec(doc, buildTypeByRefScript(field.ref, "hi@x.com", 1)) as ActResult;
    expect(res.typed).toBe(true);
    expect((doc.getElementById("e") as HTMLInputElement).value).toBe("hi@x.com");
  });

  it("refuses a stale ref after the generation bumps (store reset on navigation)", () => {
    const doc = parse(`<button id="a">One</button>`);
    const ref = nodes(doc, 1)[0].ref;
    // Same document, new generation (SPA nav): the ref must no longer resolve.
    const res = exec(doc, buildClickByRefScript(ref, 2)) as ActResult;
    expect(res.found).toBe(false);
  });

  it("refuses a disabled ref target rather than reporting a click", () => {
    const doc = parse(`<button id="a" disabled>Go</button>`);
    const ref = nodes(doc, 1)[0].ref;
    const res = exec(doc, buildClickByRefScript(ref, 1)) as ActResult;
    expect(res).toEqual({ found: true, clicked: false, reason: "disabled", matchedTotal: 1, matchedVisible: 1 });
  });
});

describe("wait condition shape (#93)", () => {
  it("refuses zero or several modes, and a name without a role", () => {
    expect(() => buildWaitConditionScript({} as never, 1)).toThrow(/exactly one/);
    expect(() => buildWaitConditionScript({ ref: "e1", text: "x" } as never, 1)).toThrow(/exactly one/);
    expect(() => buildWaitConditionScript({ role: "button", text: "x" } as never, 1)).toThrow(/exactly one/);
    expect(() => buildWaitConditionScript({ text: "x", name: "y" } as never, 1)).toThrow(/exactly one/);
  });
  it("refuses non-string fields instead of embedding them", () => {
    expect(() => buildWaitConditionScript({ text: 5 } as never, 1)).toThrow(/as strings/);
    expect(() => buildWaitConditionScript({ role: "button", name: ["x"] } as never, 1)).toThrow(/as strings/);
    expect(() => buildWaitConditionScript({ ref: {} } as never, 1)).toThrow(/as strings/);
  });
});

describe("buildWaitConditionScript (WI-P3.1)", () => {
  it("matches when the page text contains the target", () => {
    const res = run(`<main><h1>Order confirmed</h1></main>`, buildWaitConditionScript({ text: "confirmed" }, 1)) as {
      matched: boolean;
    };
    expect(res.matched).toBe(true);
  });

  it("does not match absent text", () => {
    const res = run(`<main><h1>Loading…</h1></main>`, buildWaitConditionScript({ text: "confirmed" }, 1)) as {
      matched: boolean;
    };
    expect(res.matched).toBe(false);
  });

  it("matches a role+name and returns its ref", () => {
    const res = run(`<button>Continue</button>`, buildWaitConditionScript({ role: "button", name: "Continue" }, 4)) as {
      matched: boolean;
      ref: string;
    };
    expect(res.matched).toBe(true);
    expect(res.ref).toMatch(/^e\d+$/);
  });

  it("does not match a role that is absent", () => {
    const res = run(`<p>text</p>`, buildWaitConditionScript({ role: "button", name: "Go" }, 1)) as { matched: boolean };
    expect(res.matched).toBe(false);
  });

  it("matches a ref minted at the same generation, and not after it bumps", () => {
    const doc = parse(`<button id="a">A</button>`);
    const ref = nodes(doc, 7)[0].ref;
    expect((exec(doc, buildWaitConditionScript({ ref }, 7)) as { matched: boolean }).matched).toBe(true);
    // A generation bump (navigation) resets the store; the old ref no longer matches.
    expect((exec(doc, buildWaitConditionScript({ ref }, 8)) as { matched: boolean }).matched).toBe(false);
  });
});

describe("buildClickScript", () => {
  it("clicks the element matching role + name and reports success", () => {
    const doc = new DOMParser().parseFromString(
      `<body><button id="b">Publish</button></body>`,
      "text/html",
    );
    let clicked = false;
    doc.getElementById("b")!.addEventListener("click", () => (clicked = true));
    const fn = new Function("document", buildClickScript("button", "Publish"));
    const res = JSON.parse(fn(doc) as string) as { found: boolean; clicked: boolean };
    expect(res.found).toBe(true);
    expect(res.clicked).toBe(true);
    expect(clicked).toBe(true);
  });

  it("reports not-found when no element matches", () => {
    const res = run(`<button>Cancel</button>`, buildClickScript("button", "Publish")) as {
      found: boolean;
    };
    expect(res.found).toBe(false);
  });

  it("does not cross role boundaries (a link named Publish is not a button)", () => {
    const res = run(`<a href="/x">Publish</a>`, buildClickScript("button", "Publish")) as {
      found: boolean;
    };
    expect(res.found).toBe(false);
  });

  it.each([
    [`<button disabled>Publish</button>`, "native disabled"],
    [`<fieldset disabled><button>Publish</button></fieldset>`, "disabled fieldset ancestor"],
    [`<div role="button" aria-disabled="true">Publish</div>`, "aria-disabled"],
  ])("never reports a click it did not dispatch (%s)", (html) => {
    const doc = parse(html);
    let clicked = false;
    doc.querySelector("button, [role=button]")!.addEventListener("click", () => (clicked = true));
    const role = html.includes("role=") ? "button" : "button";
    const res = exec(doc, buildClickScript(role, "Publish")) as ActResult;
    expect(res).toEqual({
      found: true,
      clicked: false,
      reason: "disabled",
      matchedTotal: 1,
      matchedVisible: 1,
    });
    expect(clicked).toBe(false);
  });

  it("never targets a hidden duplicate before the visible control", () => {
    const doc = parse(`
      <div aria-hidden="true"><button id="ghost">Publish</button></div>
      <div style="display: none"><button id="ghost2">Publish</button></div>
      <button id="real">Publish</button>`);
    const hits: string[] = [];
    doc.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => hits.push(b.id)));
    const res = exec(doc, buildClickScript("button", "Publish")) as ActResult;
    expect(res.clicked).toBe(true);
    expect(hits).toEqual(["real"]);
  });
});

// WI-NB1.1 — act truthfulness: a click result must report what actually happened,
// never merely that a dispatch occurred. Counts expose ambiguity (NeoBrowser's
// accordion-form failure class: N same-name matches, the visible one must win and
// the model must be able to see that N > 1 existed). The layout-dependent checks
// (getBoundingClientRect, computed styles, elementFromPoint occlusion) are guarded
// by a runtime layout probe, so in jsdom — no layout engine — these tests exercise
// the attribute tier; actScript.webkit.test.ts exercises the rendered tier against
// the same shipped bytes.
describe("act truthfulness (WI-NB1.1)", () => {
  it("reports matchedTotal/matchedVisible on a role+name click", () => {
    const doc = parse(`
      <div hidden><button id="h1">Continue</button></div>
      <button id="real">Continue</button>`);
    const hits: string[] = [];
    doc.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => hits.push(b.id)));
    const res = exec(doc, buildClickScript("button", "Continue")) as ActResult;
    expect(res).toEqual({ found: true, clicked: true, matchedTotal: 2, matchedVisible: 1 });
    expect(hits).toEqual(["real"]);
  });

  it("reports reason 'hidden' with counts when every match is hidden — and clicks nothing", () => {
    const doc = parse(`
      <div hidden><button id="a">Continue</button></div>
      <div aria-hidden="true"><button id="b">Continue</button></div>`);
    const hits: string[] = [];
    doc.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => hits.push(b.id)));
    const res = exec(doc, buildClickScript("button", "Continue")) as ActResult;
    expect(res).toEqual({
      found: true,
      clicked: false,
      reason: "hidden",
      matchedTotal: 2,
      matchedVisible: 0,
    });
    expect(hits).toEqual([]);
  });

  it("reports zero counts when nothing matches at all", () => {
    const res = run(`<button>Cancel</button>`, buildClickScript("button", "Publish")) as ActResult;
    expect(res).toEqual({ found: false, clicked: false, matchedTotal: 0, matchedVisible: 0 });
  });

  it("refuses to click a ref target that is attribute-hidden since it was read", () => {
    const doc = parse(`<button id="a">Go</button>`);
    const ref = nodes(doc, 3)[0].ref;
    doc.getElementById("a")!.setAttribute("hidden", "");
    let clicked = false;
    doc.getElementById("a")!.addEventListener("click", () => (clicked = true));
    const res = exec(doc, buildClickByRefScript(ref, 3)) as ActResult;
    expect(res).toEqual({ found: true, clicked: false, reason: "hidden", matchedTotal: 1, matchedVisible: 0 });
    expect(clicked).toBe(false);
  });

  it("type also picks the visible match and reports counts", () => {
    const doc = parse(`
      <div hidden><input aria-label="Email" id="ghost"></div>
      <input aria-label="Email" id="real" type="text">`);
    const res = exec(doc, buildTypeScript("textbox", "Email", "x@y.z")) as ActResult;
    expect(res.typed).toBe(true);
    expect(res.matchedTotal).toBe(2);
    expect(res.matchedVisible).toBe(1);
    expect((doc.getElementById("real") as HTMLInputElement).value).toBe("x@y.z");
    expect((doc.getElementById("ghost") as HTMLInputElement).value).toBe("");
  });

  it("type reports 'hidden' when every match is hidden", () => {
    const doc = parse(`<div hidden><input aria-label="Email"></div>`);
    const res = exec(doc, buildTypeScript("textbox", "Email", "x")) as ActResult;
    expect(res).toEqual({
      found: true,
      typed: false,
      reason: "hidden",
      matchedTotal: 1,
      matchedVisible: 0,
    });
  });
});

describe("buildTypeScript", () => {
  it("sets an input's value and fires input/change events", () => {
    const doc = new DOMParser().parseFromString(
      `<body><label for="e">Email</label><input id="e" type="text"></body>`,
      "text/html",
    );
    const input = doc.getElementById("e") as HTMLInputElement;
    let inputEvents = 0;
    input.addEventListener("input", () => (inputEvents += 1));
    const fn = new Function("document", buildTypeScript("textbox", "Email", "hi@example.com"));
    const res = JSON.parse(fn(doc) as string) as { found: boolean; typed: boolean };
    expect(res.found).toBe(true);
    expect(res.typed).toBe(true);
    expect(input.value).toBe("hi@example.com");
    expect(inputEvents).toBeGreaterThan(0);
  });

  it("reports not-found for a missing field", () => {
    const res = run(`<input type="text" aria-label="Other">`, buildTypeScript("textbox", "Name", "x")) as {
      found: boolean;
    };
    expect(res.found).toBe(false);
  });

  it("refuses a readonly field and reports why (never a silent synthetic mutation)", () => {
    const doc = parse(`<input type="text" aria-label="Slug" readonly value="fixed">`);
    const res = exec(doc, buildTypeScript("textbox", "Slug", "new")) as ActResult;
    expect(res).toEqual({ found: true, typed: false, reason: "readonly", matchedTotal: 1, matchedVisible: 1 });
    expect(doc.querySelector("input")!.value).toBe("fixed");
  });

  it("refuses a disabled field", () => {
    const doc = parse(`<input type="text" aria-label="Slug" disabled>`);
    const res = exec(doc, buildTypeScript("textbox", "Slug", "new")) as ActResult;
    expect(res).toEqual({ found: true, typed: false, reason: "disabled", matchedTotal: 1, matchedVisible: 1 });
  });

  it("refuses a non-editable target (an explicit-role textbox that is not a field)", () => {
    const doc = parse(`<div role="textbox" aria-label="Fake">x</div>`);
    const res = exec(doc, buildTypeScript("textbox", "Fake", "new")) as ActResult;
    expect(res).toEqual({ found: true, typed: false, reason: "not-editable", matchedTotal: 1, matchedVisible: 1 });
    // and no expando value property was smuggled onto the element
    expect((doc.querySelector("div") as unknown as { value?: string }).value).toBeUndefined();
  });

  it("types into a <textarea>", () => {
    const doc = parse(`<label for="t">Body</label><textarea id="t"></textarea>`);
    const res = exec(doc, buildTypeScript("textbox", "Body", "line one")) as ActResult;
    expect(res.typed).toBe(true);
    expect(doc.querySelector("textarea")!.value).toBe("line one");
  });

  it.each([["", "empty"], ["日本語テキスト", "CJK"], ["a\nb", "multiline"]])(
    "types %j (%s) verbatim",
    (text) => {
      const doc = parse(`<label for="t">Body</label><textarea id="t">old</textarea>`);
      exec(doc, buildTypeScript("textbox", "Body", text));
      expect(doc.querySelector("textarea")!.value).toBe(text);
    },
  );

  it("types into a <select> by option label and fires input/change (WI-NB1.2)", () => {
    const doc = parse(
      `<label for="c">Country</label>
       <select id="c"><option value="">—</option><option value="jp">Japan</option><option value="es">Spain</option></select>`,
    );
    const select = doc.getElementById("c") as HTMLSelectElement;
    let changes = 0;
    select.addEventListener("change", () => (changes += 1));
    const res = exec(doc, buildTypeScript("combobox", "Country", "Japan")) as ActResult;
    expect(res.typed).toBe(true);
    expect(select.value).toBe("jp");
    expect(changes).toBeGreaterThan(0);
  });

  it("types into a <select> by option value when no label matches", () => {
    const doc = parse(
      `<select aria-label="Country"><option value="jp">Japan</option><option value="es">Spain</option></select>`,
    );
    const res = exec(doc, buildTypeScript("combobox", "Country", "es")) as ActResult;
    expect(res.typed).toBe(true);
    expect((doc.querySelector("select") as HTMLSelectElement).value).toBe("es");
  });

  it("refuses a <select> option that does not exist rather than silently picking one", () => {
    const doc = parse(`<select aria-label="Country"><option value="jp">Japan</option></select>`);
    const res = exec(doc, buildTypeScript("combobox", "Country", "Atlantis")) as ActResult;
    expect(res.typed).toBe(false);
    expect(res.reason).toBe("no-such-option");
    expect((doc.querySelector("select") as HTMLSelectElement).value).toBe("jp");
  });

  it("an implicit contenteditable host is ONE textbox end to end: snapshot, locator, type (#110)", () => {
    const doc = parse(`<div contenteditable="true" aria-label="Body"><p>old <b>bold</b></p></div><p>prose</p>`);
    const snapshot = exec(doc, buildSnapshotScript(1)) as { nodes: Array<{ role: string; name: string }> };
    const textboxes = snapshot.nodes.filter((n) => n.role === "textbox");
    expect(textboxes).toEqual([{ role: "textbox", name: "Body", ref: expect.any(String) }].map((n) => expect.objectContaining(n)));
    const res = exec(doc, buildTypeScript("textbox", "Body", "new text")) as ActResult;
    expect(res.typed).toBe(true);
    expect(doc.querySelector("[contenteditable]")!.textContent).toBe("new text");
  });

  it("types into a contenteditable region (WI-NB1.2)", () => {
    const doc = parse(`<div role="textbox" aria-label="Body" contenteditable="true">old</div>`);
    // jsdom does not compute isContentEditable from the attribute; mirror the real value.
    const el = doc.querySelector("div") as HTMLElement;
    if (!el.isContentEditable) {
      Object.defineProperty(el, "isContentEditable", { configurable: true, get: () => true });
    }
    let inputs = 0;
    el.addEventListener("input", () => (inputs += 1));
    const res = exec(doc, buildTypeScript("textbox", "Body", "new text")) as ActResult;
    expect(res.typed).toBe(true);
    expect(el.textContent).toBe("new text");
    expect(inputs).toBeGreaterThan(0);
  });

  it("drives a React-style controlled input: the framework's value tracker must see a change", () => {
    const doc = parse(`<label for="e">Email</label><input id="e" type="text">`);
    const input = doc.getElementById("e") as HTMLInputElement;

    // React installs an instance-level `value` tracker; a plain `el.value = x`
    // assignment updates the tracker's cache first, so React's onChange then sees
    // "no change" and the keystroke is dropped. The act script must therefore go
    // through the native prototype setter.
    let tracked = input.value;
    const nativeValue = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input) as object,
      "value",
    )!;
    Object.defineProperty(input, "value", {
      configurable: true,
      get() {
        return nativeValue.get!.call(this);
      },
      set(next: string) {
        tracked = String(next);
        nativeValue.set!.call(this, next);
      },
    });

    let reactSawChange = false;
    input.addEventListener("input", () => {
      reactSawChange = nativeValue.get!.call(input) !== tracked;
    });

    const res = exec(doc, buildTypeScript("textbox", "Email", "hi@example.com")) as ActResult;
    expect(res.typed).toBe(true);
    expect(nativeValue.get!.call(input)).toBe("hi@example.com");
    expect(reactSawChange).toBe(true);
  });
});
