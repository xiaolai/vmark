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
import { parseActionText } from "@/lib/browser/workflow/stepGrammar";

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
