// WI-NB7.1 — the page-world recorder shim, executed byte-identical to what Rust
// injects. Proves: dormant until armed, captures locators (never values), the
// sensitivity hint comes from the field, the buffer is capped, and no bridge.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RECORDER_SHIM_SRC,
  RECORDER_BUFFER_ID,
  RECORDER_ARMED_ID,
  buildArmScript,
  buildDisarmScript,
  buildRecorderDrainScript,
} from "./recorderShim";

/** Execute the shipped shim bytes in the current jsdom document (as the page world). */
function installShim(): void {
  new Function(RECORDER_SHIM_SRC)();
}

/** Run an isolated-world builder script and return its value (the DOM is shared). */
function evalIsolated<T>(script: string): T {
  return new Function(script)() as T;
}

function drain(clear = true): Array<{ type: string; role?: string; name?: string; sensitive?: boolean }> {
  const raw = evalIsolated<string>(buildRecorderDrainScript(clear));
  return JSON.parse(raw).events;
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

describe("recorder shim — dormancy", () => {
  it("captures NOTHING until armed", () => {
    const btn = document.createElement("button");
    btn.textContent = "Publish";
    document.body.appendChild(btn);
    btn.click();
    expect(drain()).toEqual([]);
  });

  it("captures once armed, and stops again after disarm", () => {
    evalIsolated(buildArmScript());
    expect(document.getElementById(RECORDER_ARMED_ID)).not.toBeNull();
    const btn = document.createElement("button");
    btn.textContent = "Publish";
    document.body.appendChild(btn);
    btn.click();
    const events = drain(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "click", role: "button", name: "Publish" });

    evalIsolated(buildDisarmScript());
    expect(document.getElementById(RECORDER_ARMED_ID)).toBeNull();
    btn.click();
    // Buffer unchanged since the disarm — still just the one earlier click.
    expect(drain()).toHaveLength(1);
  });

  it("arm is idempotent", () => {
    evalIsolated(buildArmScript());
    evalIsolated(buildArmScript());
    expect(document.querySelectorAll(`#${RECORDER_ARMED_ID}`)).toHaveLength(1);
  });
});

describe("recorder shim — capture shape", () => {
  beforeEach(() => evalIsolated(buildArmScript()));

  it("records a click's role and accessible name, walking up to the control", () => {
    const btn = document.createElement("button");
    btn.setAttribute("aria-label", "Save changes");
    const icon = document.createElement("span");
    icon.textContent = "💾";
    btn.appendChild(icon);
    document.body.appendChild(btn);
    icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(drain()[0]).toMatchObject({ type: "click", role: "button", name: "Save changes" });
  });

  it("records a text field change as a type event with sensitive:false and NO value", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("aria-label", "Email");
    input.value = "secret@example.com";
    document.body.appendChild(input);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const ev = drain()[0];
    expect(ev).toMatchObject({ type: "type", role: "textbox", name: "Email", sensitive: false });
    // The buffer never carries the typed value.
    expect(JSON.stringify(ev)).not.toContain("secret@example.com");
  });

  it("marks a password field sensitive from its own type (not a page flag)", () => {
    const input = document.createElement("input");
    input.type = "password";
    input.setAttribute("aria-label", "Password");
    input.value = "hunter2";
    document.body.appendChild(input);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const ev = drain()[0];
    expect(ev).toMatchObject({ type: "type", sensitive: true });
    expect(JSON.stringify(ev)).not.toContain("hunter2");
  });

  it("marks an autocomplete=one-time-code field sensitive even if type=text", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("autocomplete", "one-time-code");
    input.setAttribute("aria-label", "Code");
    document.body.appendChild(input);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(drain()[0]).toMatchObject({ type: "type", sensitive: true });
  });

  it("does not double-record a checkbox (click covers it; change is skipped)", () => {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.setAttribute("aria-label", "Remember me");
    document.body.appendChild(cb);
    cb.click(); // fires click AND change in a real browser
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    const events = drain();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "click", role: "checkbox" });
  });

  it("resolves an associated <label> as the accessible name", () => {
    const label = document.createElement("label");
    label.setAttribute("for", "u");
    label.textContent = "Username";
    const input = document.createElement("input");
    input.id = "u";
    input.type = "text";
    document.body.append(label, input);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(drain()[0]).toMatchObject({ name: "Username" });
  });
});

describe("recorder shim — bounds and safety", () => {
  it("caps the ring buffer at 200 entries", () => {
    evalIsolated(buildArmScript());
    const btn = document.createElement("button");
    btn.textContent = "x";
    document.body.appendChild(btn);
    for (let i = 0; i < 250; i++) btn.click();
    expect(drain().length).toBeLessThanOrEqual(200);
  });

  it("never breaks the page and never opens a bridge (R3)", () => {
    // The shim source registers no message handler — the no-bridge invariant.
    expect(RECORDER_SHIM_SRC).not.toContain("webkit.messageHandlers");
    expect(RECORDER_SHIM_SRC).toContain(RECORDER_BUFFER_ID);
    expect(RECORDER_SHIM_SRC).toContain(RECORDER_ARMED_ID);
  });

  it("a corrupted buffer drains to [] rather than throwing", () => {
    evalIsolated(buildArmScript());
    const el = document.createElement("script");
    el.type = "application/json"; // inert, exactly as the shim creates the buffer element
    el.id = RECORDER_BUFFER_ID;
    el.textContent = "{not json";
    document.head.appendChild(el);
    expect(drain()).toEqual([]);
  });
});
