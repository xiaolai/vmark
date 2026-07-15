// WI-2.3 — injected act scripts: snapshot / click / type by role+name, run via eval
import { describe, it, expect } from "vitest";
import { buildSnapshotScript, buildClickScript, buildTypeScript } from "./actScript";
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

interface ActResult {
  found: boolean;
  clicked?: boolean;
  typed?: boolean;
  reason?: string;
}

describe("buildSnapshotScript", () => {
  it("extracts interactive/structural elements with role + name", () => {
    const snap = run(
      `<h1>Welcome</h1><button>Publish</button><a href="/x">More</a><p>ignored</p>`,
      buildSnapshotScript(),
    ) as Array<{ role: string; name: string }>;
    const byRole = Object.fromEntries(snap.map((n) => [n.role, n.name]));
    expect(byRole.heading).toBe("Welcome");
    expect(byRole.button).toBe("Publish");
    expect(byRole.link).toBe("More");
    expect(snap.some((n) => n.role === "generic")).toBe(false);
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
    const injected = exec(doc, buildSnapshotScript());
    expect(injected).toEqual(ariaSnapshot(doc.body));
  });

  it("agrees on the live checked state after interaction", () => {
    const doc = parse(`<input type="checkbox" checked aria-label="Agree">`);
    (doc.querySelector("input") as HTMLInputElement).checked = false;
    expect(exec(doc, buildSnapshotScript())).toEqual(ariaSnapshot(doc.body));
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
    expect(res).toEqual({ found: true, clicked: false, reason: "disabled" });
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
    expect(res).toEqual({ found: true, typed: false, reason: "readonly" });
    expect(doc.querySelector("input")!.value).toBe("fixed");
  });

  it("refuses a disabled field", () => {
    const doc = parse(`<input type="text" aria-label="Slug" disabled>`);
    const res = exec(doc, buildTypeScript("textbox", "Slug", "new")) as ActResult;
    expect(res).toEqual({ found: true, typed: false, reason: "disabled" });
  });

  it("refuses a non-editable target (an explicit-role textbox that is not a field)", () => {
    const doc = parse(`<div role="textbox" aria-label="Fake">x</div>`);
    const res = exec(doc, buildTypeScript("textbox", "Fake", "new")) as ActResult;
    expect(res).toEqual({ found: true, typed: false, reason: "not-editable" });
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
