// Audit R2 (#772) — WHICH element a click inside a <label> is recorded as.
//
// The shim resolved the label's control BEFORE walking up from the clicked
// node, so anything independently clickable inside the label — the link in "I
// accept the [terms]" — was recorded as a checkbox toggle. Replaying that
// recording ticks a box where the user navigated away.
//
// The walk now answers first and the label answers only when nothing below it
// did, which is why the second case is here too: an actionable ANCESTOR (a
// `role="row"` around the whole line) must still not pre-empt the label's own
// control, since it is above the label rather than below it.
//
// A separate file rather than more of `recorderShim.test.ts`, which is at the
// 800-line test cap. The bootstrap is duplicated for the same reason
// `recorderShim.residuals.test.ts` duplicates it: the TDD guard
// (.claude/rules/60-ai-governance.md §5) admits no non-test module under
// `src/lib/browser/`, so a shared harness cannot live beside them.
//
// @coordinates-with ./recorderShim.src.js — the `control()` walk under test
// @module lib/browser/agent/recorderShim.labelTarget.test
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RECORDER_SHIM_SRC, buildArmScript, buildRecorderDrainScript } from "./recorderShim";

type Recorded = { type: string; role?: string; name?: string };

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

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  installShim();
  evalIsolated(buildArmScript());
});

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("a click inside a <label> resolves to the innermost actionable target", () => {
  it.each([
    {
      what: "a link inside the label is the link",
      html: `<label id="l"><input id="cb" type="checkbox"> I accept the <a id="t" href="#terms">terms</a></label>`,
      expected: { type: "click", role: "link", name: "terms" },
    },
    {
      what: "roleless label content is still the label's control",
      html: `<div role="row"><label id="l" for="cb"><span id="t">Agree</span></label><input id="cb" type="checkbox"></div>`,
      expected: { type: "click", role: "checkbox", name: "Agree" },
    },
  ])("$what", ({ html, expected }) => {
    document.body.innerHTML = html;
    document.getElementById("t")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const events = drain();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject(expected);
  });
});
