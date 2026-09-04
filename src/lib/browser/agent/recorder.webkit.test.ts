// WI-NB7.1 — cross-document recording in REAL WebKit.
//
// The recorder's risk lives in real WebKit: a page-world DOM buffer dies on every
// cross-document navigation, and accessible-name/role computation depends on the real
// engine (jsdom has neither a layout engine nor faithful `labels`/`aria` resolution).
// This drives the whole loop — click → navigation → type → stop → parse round-trip —
// across TWO real documents (iframes, so each is a genuine separate document with its
// own listeners), exactly the shape a WKWebView navigation produces.
import { describe, it, expect, afterEach } from "vitest";
import {
  RECORDER_SHIM_SRC,
  buildArmScript,
  buildRecorderDrainScript,
} from "./recorderShim";
import { recordingToWorkflow, type RecordedEvent } from "@/lib/browser/workflow/recorder";
import { parseWorkflow } from "@/lib/browser/workflow/parser";
import { parseAction } from "@/lib/browser/workflow/stepGrammar";

/** Test convenience: the parsed action, or null when the text is not executable. */
function parseActionText(text: string) {
  const r = parseAction(text);
  return r.ok ? r.action : null;
}

const frames: HTMLIFrameElement[] = [];

/** A genuine separate document — the shim's listeners, buffer, and marker all die
 *  with it, exactly like a real navigation. */
function newDocument(bodyHtml: string): Window {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  frames.push(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head></head><body>${bodyHtml}</body></html>`);
  doc.close();
  return iframe.contentWindow!;
}

/** Run a script in the FRAME's realm — `new Function` off the frame's own constructor,
 *  so `document`/`window` resolve to that document (the driver's isolated-world seam). */
function runIn(win: Window, src: string): unknown {
  return (win as unknown as { Function: (s: string) => () => unknown }).Function(src)();
}

function installAndArm(win: Window): void {
  runIn(win, RECORDER_SHIM_SRC); // dormant
  runIn(win, buildArmScript()); // arm
}

function drain(win: Window): RecordedEvent[] {
  const raw = runIn(win, buildRecorderDrainScript(true)) as string;
  return JSON.parse(raw).events as RecordedEvent[];
}

/** Dispatch a same-realm DOM event on `el` using the frame's own `Event` constructor,
 *  so it bubbles to the shim's listeners in that document. */
function fire(win: Window, el: Element, type: string): void {
  const Ctor = (win as unknown as { Event: typeof Event }).Event;
  el.dispatchEvent(new Ctor(type, { bubbles: true }));
}

afterEach(() => {
  for (const f of frames) f.remove();
  frames.length = 0;
});

describe("recorder — cross-document, real WebKit", () => {
  it("records click → navigation → type → stop and round-trips through the parser", () => {
    // Document A — a button whose label the real engine must resolve from aria-label.
    const a = newDocument(`<button id="go" aria-label="Sign in">Sign in</button>`);
    installAndArm(a);
    fire(a, a.document.getElementById("go")!, "click");
    const eventsA = drain(a);
    expect(eventsA).toContainEqual({ type: "click", role: "button", name: "Sign in" });

    // Navigation → Document B. The host records the nav (native URL) and re-arms the
    // fresh document; the shim from A is gone with A's document.
    const b = newDocument(
      `<label for="email">Email</label><input id="email" type="text">` +
        `<input id="pw" type="password" aria-label="Password">`,
    );
    installAndArm(b);
    const email = b.document.getElementById("email") as HTMLInputElement;
    email.value = "someone@example.com"; // typed value must NEVER survive
    fire(b, email, "change");
    const pw = b.document.getElementById("pw") as HTMLInputElement;
    pw.value = "hunter2";
    fire(b, pw, "change");
    const eventsB = drain(b);

    // The label was resolved from a real <label for> association.
    expect(eventsB.find((e) => e.type === "type" && !e.sensitive)?.name).toBe("Email");
    // The password field was classified sensitive from its real type.
    expect(eventsB.find((e) => e.sensitive)?.type).toBe("type");

    // Assemble as the host would: A, the navigation, then B.
    const trace: RecordedEvent[] = [
      ...eventsA,
      { type: "navigate", url: "https://app.test/login?token=SECRET#f" },
      ...eventsB,
    ];
    const { source, inputs } = recordingToWorkflow(trace, { site: "app" });

    // Round-trips through the REAL parser, and every action step is executable.
    const parsed = parseWorkflow(source);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      for (const step of parsed.workflow.steps.filter((s) => s.kind === "action")) {
        expect(parseActionText(step.text)).not.toBeNull();
      }
    }

    // P-2, end to end: no typed value, URL stripped, email → variable, password → confirm.
    expect(source).not.toContain("someone@example.com");
    expect(source).not.toContain("hunter2");
    expect(source).not.toContain("SECRET");
    expect(source).toContain("action: navigate to https://app.test/login");
    expect(inputs).toContain("Email");
    expect(source).toContain("confirm:");
  });
});

// S-01 — in real WebKit, across two real documents: a clearing drain must stick.
// The shim's closure array used to re-publish every drained event on the next
// event, so a recording held each step once per drain interval it survived.
describe("recorder — drained events are never re-published (S-01), real WebKit", () => {
  it("drain(clear) → click → drain returns only the new click, in each document", () => {
    const a = newDocument(`<button id="one">One</button><button id="two">Two</button>`);
    installAndArm(a);
    fire(a, a.document.getElementById("one")!, "click");
    expect(drain(a).map((e) => e.name)).toEqual(["One"]);
    fire(a, a.document.getElementById("two")!, "click");
    expect(drain(a).map((e) => e.name)).toEqual(["Two"]);
    expect(drain(a)).toEqual([]);

    // A fresh document has a fresh shim and a fresh stamp: the same property holds.
    const b = newDocument(`<button id="three">Three</button><button id="four">Four</button>`);
    installAndArm(b);
    fire(b, b.document.getElementById("three")!, "click");
    expect(drain(b).map((e) => e.name)).toEqual(["Three"]);
    fire(b, b.document.getElementById("four")!, "click");
    fire(b, b.document.getElementById("four")!, "click");
    expect(drain(b).map((e) => e.name)).toEqual(["Four", "Four"]);
  });

  it("records the replayer's role vocabulary and omits the role of a target that has none", () => {
    const a = newDocument(`<div id="d" role="Button">Custom</div><a id="anchor">no href</a><input id="n" type="number" aria-label="Qty">`);
    installAndArm(a);
    fire(a, a.document.getElementById("d")!, "click");
    fire(a, a.document.getElementById("anchor")!, "click");
    fire(a, a.document.getElementById("n")!, "change");
    const events = drain(a);
    expect(events[0]).toEqual({ type: "click", role: "button", name: "Custom" });
    expect(events[1]).toEqual({ type: "click", name: "no href" });
    expect(events[2]).toMatchObject({ type: "type", role: "spinbutton", name: "Qty", sensitive: false });
  });
});

describe("label activation in real WebKit (#122)", () => {
  it("a label click records ONE click on its control; two direct clicks record two", () => {
    const win = newDocument(`<label id="l" for="cb">Agree</label><input id="cb" type="checkbox">`);
    installAndArm(win);
    const doc = win.document;
    (doc.getElementById("l") as HTMLLabelElement).click(); // WebKit fires the control's activation click
    let events = drain(win);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "click", role: "checkbox", name: "Agree" });
    const cb = doc.getElementById("cb") as HTMLInputElement;
    cb.click();
    cb.click();
    events = drain(win);
    expect(events).toHaveLength(2);
  });
});
