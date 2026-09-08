// Audit R3 #773/#778 — the recorder shim's ancestor WALK and its
// contenteditable commit, both of which only misbehave on shapes a real
// component tree produces.
//
//   - #773: the walk stopped after eight hops, which reads like a safety bound
//     and behaved like a claim about markup depth. A design-system button nests
//     icon -> svg -> g -> path under two or three styled wrappers, so eight
//     lands inside the button's own markup and the roleless inner node was
//     recorded — degrading a click into a manual `confirm:` step.
//   - #778: `focusout` fires when focus moves between DESCENDANTS of one
//     editing host, and the commit did not inspect `relatedTarget`, so a rich
//     editor with a focusable widget inside the region emitted a `type` step
//     per hop and forgot the pending edit each time.
//
// A separate file rather than more of `recorderShim.test.ts`, which is at the
// 800-line test cap. The bootstrap is duplicated for the same reason
// `recorderShim.labelTarget.test.ts` duplicates it: the TDD guard
// (.claude/rules/60-ai-governance.md §5) admits no non-test module under
// `src/lib/browser/`, so a shared harness cannot live beside them.
//
// @coordinates-with ./recorderShim.src.js — the `control()` walk and the commit
// @module lib/browser/agent/recorderShim.walk.test
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RECORDER_SHIM_SRC, buildArmScript, buildRecorderDrainScript } from "./recorderShim";

type Recorded = { type: string; role?: string; name?: string; sensitive?: boolean };

/** Execute the shipped shim bytes in the current jsdom document (as the page world). */
function installShim(): void {
  new Function(RECORDER_SHIM_SRC)();
}

/** Run an isolated-world builder script and return its value (the DOM is shared). */
function evalIsolated<T>(script: string): T {
  return new Function(script)() as T;
}

function drain(): Recorded[] {
  const raw = evalIsolated<string>(buildRecorderDrainScript(true));
  return (JSON.parse(raw) as { events: Recorded[] }).events;
}

/** Mount `html` in the body and return the element with `id`. */
function mount<T extends Element = HTMLElement>(html: string, id: string): T {
  document.body.innerHTML = html;
  return document.getElementById(id) as unknown as T;
}

function fire(el: Element, type: string): void {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  installShim();
});

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("recorder shim — the ancestor walk reaches a real component's control", () => {
  beforeEach(() => evalIsolated(buildArmScript()));

  it("finds the button above twelve wrapper elements", () => {
    // A design-system button nests icon → svg → g → path under several styled
    // wrappers. A fixed eight-hop budget stopped inside that markup and
    // recorded the innermost node, which has no role — so the converter
    // degraded a plain click into a manual `confirm:` step.
    const wrappers = "<span>".repeat(12);
    const closers = "</span>".repeat(12);
    mount(
      `<button id="b" aria-label="Save changes">${wrappers}<i id="deep">icon</i>${closers}</button>`,
      "b",
    );
    document.getElementById("deep")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(drain()[0]).toMatchObject({ type: "click", role: "button", name: "Save changes" });
  });

  it("still falls back to the clicked element when NOTHING actionable is above it", () => {
    const el = mount(`<div id="d"><span id="s">plain text</span></div>`, "d");
    expect(el).not.toBeNull();
    document.getElementById("s")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(drain()[0]).toMatchObject({ type: "click" });
  });
});

describe("recorder shim — a contenteditable commits when focus LEAVES it (#778)", () => {
  beforeEach(() => evalIsolated(buildArmScript()));

  function focusOut(from: Element, to: Element | null): void {
    from.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: to }));
  }

  it("does not commit while focus moves between descendants of one editing host", () => {
    const host = mount(
      `<div id="h" contenteditable="true" aria-label="Body"><span id="a">a</span><button id="b">bold</button></div>`,
      "h",
    );
    fire(document.getElementById("a")!, "input");
    focusOut(document.getElementById("a")!, document.getElementById("b")!);
    expect(drain()).toEqual([]);
    // …and the edit is still pending, so leaving for real still commits it.
    focusOut(host, null);
    expect(drain()).toEqual([
      { type: "type", role: "textbox", name: "Body", sensitive: false },
    ]);
  });

  it("commits once when focus leaves the host for an element outside it", () => {
    const host = mount(
      `<div id="h" contenteditable="true" aria-label="Body">x</div><button id="out">Send</button>`,
      "h",
    );
    fire(host, "input");
    focusOut(host, document.getElementById("out")!);
    expect(drain()).toEqual([
      { type: "type", role: "textbox", name: "Body", sensitive: false },
    ]);
  });
});
