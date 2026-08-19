// WI-NB1.1 / WI-NB1.5 — act truthfulness, rendered tier (real WebKit).
//
// jsdom has no layout engine, so the rendered-visibility checks
// (getBoundingClientRect, computed styles, collapsed-ancestor clipping) and the
// elementFromPoint occlusion check self-disable there and are exercised ONLY
// here, against the real WebKit the embedded browser runs on. The fixture is a
// port of NeoBrowser's multistep-form trap page (docs/BUGS-formularios-multipaso.md,
// rust/tests/multistep_forms.rs): the failure class is "success reported because
// the action was dispatched, not because its effect was verified".
//
// Every assertion here is about EFFECTS — which element actually received the
// click, what value a control actually holds — never about return values alone.
import { describe, it, expect, beforeEach } from "vitest";
import {
  buildClickScript,
  buildClickByRefScript,
  buildSnapshotScript,
  buildTypeScript,
} from "./actScript";

interface ActResult {
  found: boolean;
  clicked?: boolean;
  typed?: boolean;
  reason?: string;
  by?: string;
  matchedTotal?: number;
  matchedVisible?: number;
}

/** Execute a generated agent script against the REAL document (as the driver
 *  would in the page's isolated world). */
function exec(script: string): unknown {
  const fn = new Function("document", script);
  return JSON.parse(fn(document) as string);
}

function hits(): string[] {
  return (window as unknown as { __hits: string[] }).__hits;
}

beforeEach(() => {
  (window as unknown as { __hits: string[] }).__hits = [];
  delete (document as unknown as { __vmarkRefStore?: unknown }).__vmarkRefStore;
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
  window.scrollTo(0, 0);
});

function mount(html: string): void {
  document.body.innerHTML = html;
  document.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => hits().push(b.id)),
  );
}

describe("collapsed-accordion trap (the NeoBrowser bug-1 class)", () => {
  it("clicks the visible step's button, not the first same-name match in a height:0 step", () => {
    mount(`
      <form id="step1" style="height:0;overflow:hidden"><button id="c1" type="button">Continue</button></form>
      <form id="step2"><button id="c2" type="button">Continue</button></form>`);
    const res = exec(buildClickScript("button", "Continue")) as ActResult;
    expect(res.clicked).toBe(true);
    expect(res.matchedTotal).toBe(2);
    expect(res.matchedVisible).toBe(1);
    expect(hits()).toEqual(["c2"]);
  });

  it("reports 'hidden' with counts — and clicks nothing — when every match is collapsed", () => {
    mount(`
      <form style="height:0;overflow:hidden"><button id="a" type="button">Continue</button></form>
      <form style="height:0;overflow:hidden"><button id="b" type="button">Continue</button></form>`);
    const res = exec(buildClickScript("button", "Continue")) as ActResult;
    expect(res).toMatchObject({ found: true, clicked: false, reason: "hidden", matchedTotal: 2, matchedVisible: 0 });
    expect(hits()).toEqual([]);
  });

  it("a zero-height BODY does not hide the whole page (ancestor walk stops before body)", () => {
    document.body.setAttribute("style", "height:0");
    mount(`<button id="go" type="button">Go</button>`);
    const res = exec(buildClickScript("button", "Go")) as ActResult;
    expect(res.clicked).toBe(true);
    expect(hits()).toEqual(["go"]);
  });
});

describe("stylesheet-hidden targets (invisible to the attribute tier)", () => {
  it("skips a class-hidden duplicate that jsdom's attribute checks cannot see", () => {
    mount(`
      <style>.off{display:none}</style>
      <div class="off"><button id="ghost" type="button">Publish</button></div>
      <button id="real" type="button">Publish</button>`);
    const res = exec(buildClickScript("button", "Publish")) as ActResult;
    expect(res.clicked).toBe(true);
    expect(res.matchedTotal).toBe(2);
    expect(res.matchedVisible).toBe(1);
    expect(hits()).toEqual(["real"]);
  });

  it("refuses an opacity:0 target", () => {
    mount(`<button id="invis" type="button" style="opacity:0">Buy</button>`);
    const res = exec(buildClickScript("button", "Buy")) as ActResult;
    expect(res).toMatchObject({ found: true, clicked: false, reason: "hidden" });
    expect(hits()).toEqual([]);
  });
});

describe("occlusion (the NeoBrowser bug-2 class)", () => {
  it("refuses a click whose point lands on an overlay, and names the occluder", () => {
    mount(`
      <button id="target" type="button">Accept terms</button>
      <div class="cmp-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:10"></div>`);
    const res = exec(buildClickScript("button", "Accept terms")) as ActResult;
    expect(res).toMatchObject({ found: true, clicked: false, reason: "obscured" });
    expect(res.by).toBe("div.cmp-overlay");
    expect(hits()).toEqual([]);
  });

  it("a descendant of the target under the click point is NOT an occluder", () => {
    mount(`<button id="btn" type="button"><span style="display:inline-block;padding:12px">Save</span></button>`);
    const res = exec(buildClickScript("button", "Save")) as ActResult;
    expect(res.clicked).toBe(true);
    expect(hits()).toEqual(["btn"]);
  });

  it("scrolls an off-screen target into view before clicking (never a blind miss)", () => {
    mount(`
      <div style="height:3000px">spacer</div>
      <button id="far" type="button">Submit application</button>`);
    expect(window.scrollY).toBe(0);
    const res = exec(buildClickScript("button", "Submit application")) as ActResult;
    expect(res.clicked).toBe(true);
    expect(hits()).toEqual(["far"]);
    expect(window.scrollY).toBeGreaterThan(0);
  });

  it("ref clicks get the same protection: an overlay added after the read blocks the click", () => {
    mount(`<button id="b" type="button">Pay</button>`);
    const snap = exec(buildSnapshotScript(1)) as Array<{ role: string; ref: string }>;
    const ref = snap.find((n) => n.role === "button")!.ref;
    const overlay = document.createElement("div");
    overlay.className = "late-modal";
    overlay.setAttribute("style", "position:fixed;inset:0;z-index:99");
    document.body.appendChild(overlay);
    const res = exec(buildClickByRefScript(ref, 1)) as ActResult;
    expect(res).toMatchObject({ found: true, clicked: false, reason: "obscured", by: "div.late-modal" });
    expect(hits()).toEqual([]);
  });
});

describe("typing effects in a real engine", () => {
  it("select: picking an option by label moves the real value and fires change", () => {
    document.body.innerHTML = `
      <label for="c">Country</label>
      <select id="c"><option value="">—</option><option value="jp">Japan</option></select>`;
    const select = document.getElementById("c") as HTMLSelectElement;
    let changed = false;
    select.addEventListener("change", () => (changed = true));
    const res = exec(buildTypeScript("combobox", "Country", "Japan")) as ActResult;
    expect(res.typed).toBe(true);
    expect(select.value).toBe("jp");
    expect(changed).toBe(true);
  });

  it("contenteditable: text lands and input fires", () => {
    document.body.innerHTML = `<div id="ed" role="textbox" aria-label="Body" contenteditable="true">old</div>`;
    const ed = document.getElementById("ed") as HTMLElement;
    let inputs = 0;
    ed.addEventListener("input", () => (inputs += 1));
    const res = exec(buildTypeScript("textbox", "Body", "fresh")) as ActResult;
    expect(res.typed).toBe(true);
    expect(ed.textContent).toBe("fresh");
    expect(inputs).toBe(1);
  });
});
