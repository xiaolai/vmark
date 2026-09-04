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
  buildWaitConditionScript,
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

  it("the snapshot and a role wait do not perceive a class-hidden element (#101)", () => {
    mount(
      `<style>.gone{visibility:hidden}</style>` +
        `<button id="shown">Save</button><button id="hidden" class="gone">Save</button>`,
    );
    const snapshot = exec(buildSnapshotScript(1)) as { nodes: Array<{ role: string; name: string }> };
    expect(snapshot.nodes.filter((n) => n.role === "button" && n.name === "Save")).toHaveLength(1);
    mount(`<style>.gone{visibility:hidden}</style><button id="hidden" class="gone">Only hidden</button>`);
    const waited = exec(buildWaitConditionScript({ role: "button", name: "Only hidden" }, 1)) as { matched: boolean };
    expect(waited.matched).toBe(false);
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
    const snap = exec(buildSnapshotScript(1)) as { nodes: Array<{ role: string; ref: string }> };
    const ref = snap.nodes.find((n) => n.role === "button")!.ref;
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

// Audit 2026-09-03 — the rendered tier of the new refusals. Everything below
// needs a layout engine or a real hit-test and self-disables in jsdom.
describe("ambiguity in a real engine (S-03)", () => {
  it("two rendered same-name buttons are refused as ambiguous, and a candidate ref lands on the chosen one", () => {
    mount(`<button id="c1" type="button">Continue</button><button id="c2" type="button">Continue</button>`);
    const res = exec(buildClickScript("button", "Continue", 3)) as ActResult & { candidates?: Array<{ ref: string; text: string }> };
    expect(res).toMatchObject({ found: true, clicked: false, reason: "ambiguous", matchedTotal: 2, matchedVisible: 2 });
    expect(hits()).toEqual([]);
    expect(res.candidates).toHaveLength(2);
    const second = exec(buildClickByRefScript(res.candidates![1].ref, 3)) as ActResult;
    expect(second).toEqual({ found: true, clicked: true, matchedTotal: 1, matchedVisible: 1 });
    expect(hits()).toEqual(["c2"]);
  });
});

describe("visibility and hit-test holes (S-04)", () => {
  it("an off-screen twin (left:-9999px) never competes: the on-screen button is acted on", () => {
    mount(`
      <button id="off" type="button" style="position:absolute;left:-9999px;top:0">Continue</button>
      <button id="on" type="button">Continue</button>`);
    const res = exec(buildClickScript("button", "Continue")) as ActResult;
    expect(res).toEqual({ found: true, clicked: true, matchedTotal: 2, matchedVisible: 1 });
    expect(hits()).toEqual(["on"]);
  });

  it("a target the scroll cannot bring into the viewport is refused as 'offscreen'", () => {
    mount(`<button id="far" type="button" style="position:fixed;top:calc(100vh + 200px);left:10px">Far away</button>`);
    const res = exec(buildClickScript("button", "Far away")) as ActResult;
    expect(res).toMatchObject({ found: true, clicked: false, reason: "offscreen" });
    expect(hits()).toEqual([]);
  });

  it("an opacity:0 ANCESTOR hides the target", () => {
    mount(`<div style="opacity:0"><button id="ghost" type="button">Buy</button></div>`);
    const res = exec(buildClickScript("button", "Buy")) as ActResult;
    expect(res).toMatchObject({ found: true, clicked: false, reason: "hidden", matchedVisible: 0 });
    expect(hits()).toEqual([]);
  });

  it("a pointer-events:none target (or ancestor) is 'disabled' with detail 'inert'", () => {
    mount(`<div style="pointer-events:none"><button id="pe" type="button">Go</button></div>`);
    const res = exec(buildClickScript("button", "Go")) as ActResult & { detail?: string };
    expect(res).toEqual({ found: true, clicked: false, reason: "disabled", detail: "inert", matchedTotal: 1, matchedVisible: 0 });
    expect(hits()).toEqual([]);
  });

  it("an inert subtree is 'disabled' with detail 'inert' in a real engine too", () => {
    mount(`<div inert><button id="i" type="button">Go</button></div>`);
    const res = exec(buildClickScript("button", "Go")) as ActResult & { detail?: string };
    expect(res).toMatchObject({ found: true, clicked: false, reason: "disabled", detail: "inert" });
    expect(hits()).toEqual([]);
  });

  it("visibility:collapse hides a table row's control", () => {
    mount(`<table><tr style="visibility:collapse"><td><button id="row" type="button">Row action</button></td></tr></table>`);
    const res = exec(buildClickScript("button", "Row action")) as ActResult;
    expect(res).toMatchObject({ found: true, clicked: false, reason: "hidden" });
    expect(hits()).toEqual([]);
  });
});

describe("shadow DOM in a real engine (S-05)", () => {
  it("clicks a button inside an open shadow root — the retargeted hit is related to the target", () => {
    document.body.innerHTML = `<div id="host"></div>`;
    const root = document.getElementById("host")!.attachShadow({ mode: "open" });
    root.innerHTML = `<button id="in" type="button">Inner</button>`;
    root.getElementById("in")!.addEventListener("click", () => hits().push("in"));
    const res = exec(buildClickScript("button", "Inner")) as ActResult;
    expect(res).toEqual({ found: true, clicked: true, matchedTotal: 1, matchedVisible: 1 });
    expect(hits()).toEqual(["in"]);
  });

  it("an overlay living inside a shadow root still occludes, and is named by its own description", () => {
    mount(`<button id="pay" type="button">Pay</button><x-veil id="v"></x-veil>`);
    document.getElementById("v")!.attachShadow({ mode: "open" }).innerHTML =
      `<div class="veil" style="position:fixed;inset:0;z-index:5"></div>`;
    const res = exec(buildClickScript("button", "Pay")) as ActResult;
    expect(res).toMatchObject({ found: true, clicked: false, reason: "obscured", by: "div.veil" });
    expect(hits()).toEqual([]);
  });

  it("the snapshot reports the shadow node and counts a frame as unreachable", () => {
    document.body.innerHTML = `<div id="host"></div><iframe></iframe>`;
    document.getElementById("host")!.attachShadow({ mode: "open" }).innerHTML = `<button type="button">Inner</button>`;
    const snap = exec(buildSnapshotScript(2)) as { nodes: Array<{ name: string }>; unreachable: { frames: number } };
    expect(snap.nodes.map((n) => n.name)).toEqual(["Inner"]);
    expect(snap.unreachable.frames).toBe(1);
  });
});

describe("bounded occluder description (S-12)", () => {
  it("a 500-char class token never reaches `by`", () => {
    mount(`
      <button id="t" type="button">Accept</button>
      <div class="${"z".repeat(500)} cmp" style="position:fixed;inset:0;z-index:10"></div>`);
    const res = exec(buildClickScript("button", "Accept")) as ActResult;
    expect(res).toMatchObject({ reason: "obscured", by: "div.cmp" });
    expect(res.by!.length).toBeLessThanOrEqual(64);
  });
});

describe("contenteditable in a real engine (S-08)", () => {
  it("an editor that cancels beforeinput owns the insertion: no mutation, detail 'editor-handled'", () => {
    document.body.innerHTML = `<div id="ed" role="textbox" aria-label="Body" contenteditable="true">model</div>`;
    const ed = document.getElementById("ed")!;
    let inputs = 0;
    ed.addEventListener("beforeinput", (ev) => ev.preventDefault());
    ed.addEventListener("input", () => (inputs += 1));
    const res = exec(buildTypeScript("textbox", "Body", "fresh")) as ActResult & { detail?: string };
    // The editor cancelled the insertion and changed nothing visible: that is a
    // refusal now, not a typed value (audit 2026-09-03 round 1).
    expect(res).toMatchObject({ found: true, typed: false, reason: "rejected-value", detail: "editor-cancelled" });
    expect(ed.textContent).toBe("model");
    expect(inputs).toBe(0);
  });

  it("beforeinput reaches the editor before the text lands, with inputType and data", () => {
    document.body.innerHTML = `<div id="ed" role="textbox" aria-label="Body" contenteditable="true">old</div>`;
    const ed = document.getElementById("ed")!;
    const seen: string[] = [];
    ed.addEventListener("beforeinput", (ev) => {
      const ie = ev as InputEvent;
      seen.push(`${ie.inputType}:${ie.data}:${ed.textContent}`);
    });
    const res = exec(buildTypeScript("textbox", "Body", "fresh")) as ActResult;
    expect(res.typed).toBe(true);
    expect(seen[0]).toBe("insertText:fresh:old");
    expect(ed.textContent).toBe("fresh");
  });
});
