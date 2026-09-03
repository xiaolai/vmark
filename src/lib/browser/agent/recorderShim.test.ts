// WI-NB7.1 — the page-world recorder shim, executed byte-identical to what Rust
// injects. Proves: dormant until armed, captures locators (never values), the
// sensitivity hint comes from the field, the buffer is capped, and no bridge.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RECORDER_SHIM_SRC,
  RECORDER_SHIM_BODY,
  RECORDER_BUFFER_ID,
  RECORDER_ARMED_ID,
  buildArmScript,
  buildDisarmScript,
  buildRecorderDrainScript,
} from "./recorderShim";
import { AGENT_CORE_SRC } from "./agentCore";

type Recorded = { type: string; role?: string; name?: string; sensitive?: boolean };

/** Execute the shipped shim bytes in the current jsdom document (as the page world). */
function installShim(): void {
  new Function(RECORDER_SHIM_SRC)();
}

/** Run an isolated-world builder script and return its value (the DOM is shared). */
function evalIsolated<T>(script: string): T {
  return new Function(script)() as T;
}

function drain(clear = true): Recorded[] {
  const raw = evalIsolated<string>(buildRecorderDrainScript(clear));
  return JSON.parse(raw).events;
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

  it("never reads a field's value — the Rust include pins the same byte-level claim", () => {
    expect(RECORDER_SHIM_SRC).not.toContain(".value");
  });

  it("a page-forged drain counter only costs the page its own buffered events", () => {
    evalIsolated(buildArmScript());
    const a = mount(`<button id="a">A</button><button id="b">B</button>`, "a");
    a.click();
    document.getElementById(RECORDER_BUFFER_ID)!.setAttribute("data-drain", "forged");
    document.getElementById("b")!.click();
    // The forge reset the shim's copy: A is gone, B is what the page now publishes.
    expect(drain().map((e) => e.name)).toEqual(["B"]);
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

// S-01: the closure array was the source of truth and was rewritten into the DOM
// on every event, so after the host cleared the element the next event
// re-published everything already drained — a recording held each step once per
// drain interval it survived. The clearing drain now stamps a counter on the
// element and the shim drops its copy when the counter it last saw has moved.
describe("recorder shim — drained events are never re-published (S-01)", () => {
  beforeEach(() => evalIsolated(buildArmScript()));

  it("drain(clear) → click → drain returns only the new click", () => {
    const a = mount(`<button id="a">A</button><button id="b">B</button>`, "a");
    a.click();
    expect(drain()).toEqual([{ type: "click", role: "button", name: "A" }]);
    document.getElementById("b")!.click();
    expect(drain()).toEqual([{ type: "click", role: "button", name: "B" }]);
    expect(drain()).toEqual([]);
  });

  it("a non-clearing drain leaves the buffer intact for the next clearing one", () => {
    const a = mount(`<button id="a">A</button><button id="b">B</button>`, "a");
    a.click();
    expect(drain(false)).toHaveLength(1);
    document.getElementById("b")!.click();
    expect(drain(true).map((e) => e.name)).toEqual(["A", "B"]);
    expect(drain(false)).toEqual([]);
  });

  it("the clearing drain stamps a fresh nonce each time; a plain drain does not touch it", () => {
    const a = mount(`<button id="a">A</button>`, "a");
    a.click();
    drain(true);
    const first = document.getElementById(RECORDER_BUFFER_ID)!.getAttribute("data-drain");
    expect(first).toBeTruthy();
    drain(true);
    const second = document.getElementById(RECORDER_BUFFER_ID)!.getAttribute("data-drain");
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    drain(false);
    expect(document.getElementById(RECORDER_BUFFER_ID)!.getAttribute("data-drain")).toBe(second);
  });
});

// S-02: the shim carried its own role/name rules (`roleOf`, `accName`) that
// disagreed with the replayer's — bare tag names, `generic`, uncased `role`
// attributes, placeholder before label — so a recorded locator could be a dead
// production. The shim is now a BODY wrapped with the shared perception core,
// exactly as Rust concatenates it, and uses `__vmarkRole` / `__vmarkName`.
describe("recorder shim — one perception core with the replayer (S-02)", () => {
  beforeEach(() => evalIsolated(buildArmScript()));

  it("is the core plus the body inside one IIFE — the shape Rust concat!s", () => {
    expect(RECORDER_SHIM_SRC.startsWith("(function(){")).toBe(true);
    expect(RECORDER_SHIM_SRC.trimEnd().endsWith("})();")).toBe(true);
    expect(RECORDER_SHIM_SRC).toContain(AGENT_CORE_SRC);
    expect(RECORDER_SHIM_SRC).toContain(RECORDER_SHIM_BODY);
    expect(RECORDER_SHIM_SRC.indexOf(AGENT_CORE_SRC)).toBeLessThan(RECORDER_SHIM_SRC.indexOf(RECORDER_SHIM_BODY));
  });

  it("the body defines no private role/name computation and calls the core's", () => {
    expect(RECORDER_SHIM_BODY).not.toMatch(/function\s+(roleOf|accName|idText|labelText)\s*\(/);
    expect(RECORDER_SHIM_BODY).toContain("__vmarkRole(");
    expect(RECORDER_SHIM_BODY).toContain("__vmarkName(");
    // Still dormant-by-marker, still the same buffer contract.
    expect(RECORDER_SHIM_BODY).toContain("function armed()");
  });

  it.each([
    [`<div id="t" role=" Button ">Go</div>`, "button"],
    [`<input id="t" type="number" aria-label="Qty">`, "spinbutton"],
    [`<input id="t" type="search" aria-label="Find">`, "searchbox"],
    [`<a id="t" href="/x">Go</a>`, "link"],
    [`<summary id="t">More</summary>`, "button"],
    [`<div id="t" role="button link">Go</div>`, "button"],
  ])("records the replayer's role vocabulary for %s", (html, role) => {
    mount(html, "t").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(drain()[0]).toMatchObject({ type: "click", role });
  });

  it.each([
    [`<a id="t">no href</a>`, "no href"],
    [`<div id="t">plain</div>`, "plain"],
    [`<div id="t" role="presentation">deco</div>`, "deco"],
  ])("omits `role` when the core says the target has none (%s)", (html, name) => {
    mount(html, "t").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const ev = drain()[0];
    expect(ev).toEqual({ type: "click", name });
    expect("role" in ev).toBe(false);
  });

  it("names by accname precedence: labelledby over aria-label over label over placeholder", () => {
    const html =
      `<span id="lbl">From reference</span>` +
      `<input id="t" type="text" aria-labelledby="lbl" aria-label="Direct" placeholder="Hint">` +
      `<label for="u">Username</label><input id="u" type="text" placeholder="Hint">` +
      `<input id="p" type="text" placeholder="Only a hint">`;
    mount(html, "t");
    for (const id of ["t", "u", "p"]) fire(document.getElementById(id)!, "change");
    expect(drain().map((e) => e.name)).toEqual(["From reference", "Username", "Only a hint"]);
  });

  it("normalises names like the replayer: NFC, format characters stripped, whitespace collapsed", () => {
    const btn = mount(`<button id="t" aria-label="Publ\u200Bish  \u202Enow\u202C">x</button>`, "t");
    btn.click();
    expect(drain()[0].name).toBe("Publish now");
  });

  it("resolves the real target through an open shadow root, not the retargeted host", () => {
    const host = mount(`<x-host id="t"></x-host>`, "t");
    const root = host.attachShadow({ mode: "open" });
    const inner = document.createElement("button");
    inner.textContent = "Inner";
    root.appendChild(inner);
    inner.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(drain()[0]).toEqual({ type: "click", role: "button", name: "Inner" });
  });
});

// S-11: sensitivity was read from `type` and a few autocomplete substrings at
// `change` time only, so a show-password toggle laundered a secret into an
// `{input}` variable, and OTP/CVV fields named by `name`/`id`/`aria-label`
// passed as ordinary text.
describe("recorder shim — sensitivity (S-11)", () => {
  beforeEach(() => evalIsolated(buildArmScript()));

  function changed(attrs: string): Recorded {
    document.body.innerHTML = `<input type="text" ${attrs}>`;
    fire(document.querySelector("input")!, "change");
    return drain()[0];
  }

  it.each([
    ["autocomplete=cc-exp", `autocomplete="cc-exp"`],
    ["autocomplete=cc-csc", `autocomplete="cc-csc"`],
    ["autocomplete with section/shipping prefixes", `autocomplete="section-blue shipping cc-name"`],
    ["autocomplete=new-password", `autocomplete="new-password"`],
    ["autocomplete=current-password", `autocomplete="current-password"`],
    ["autocomplete=one-time-code", `autocomplete="one-time-code"`],
    ["name=cvv", `name="cvv"`],
    ["name with hyphenated otp", `name="one-time-otp"`],
    ["id=ssn", `id="ssn"`],
    ["aria-label mentioning PIN", `aria-label="Enter your PIN"`],
    ["name=api-token", `name="api-token"`],
    ["name=passcode (case-insensitive)", `name="PassCode"`],
    ["name=secret", `name="secret"`],
  ])("marks %s sensitive", (_label, attrs) => {
    expect(changed(attrs)).toMatchObject({ type: "type", sensitive: true });
  });

  it.each([
    ["a word that merely contains a keyword", `name="tokenizer"`],
    ["pinned is not pin", `name="pinned_items"`],
    ["an ordinary email field", `name="email" autocomplete="email"`],
    ["shipping street", `autocomplete="shipping street-address"`],
  ])("does not mark %s sensitive", (_label, attrs) => {
    expect(changed(attrs)).toMatchObject({ type: "type", sensitive: false });
  });

  it("stays sensitive across a show-password toggle before change (sticky per element)", () => {
    const pw = mount(`<input id="t" type="password" aria-label="Password">`, "t") as HTMLInputElement;
    fire(pw, "focusin");
    fire(pw, "input");
    pw.type = "text"; // the page's "show password" toggle
    fire(pw, "change");
    expect(drain()[0]).toMatchObject({ type: "type", name: "Password", sensitive: true });
  });

  it("a password episode in the middle of typing (text → password → text) is still sensitive", () => {
    const el = mount(`<input id="t" type="text" aria-label="Code">`, "t") as HTMLInputElement;
    fire(el, "input");
    el.type = "password";
    fire(el, "input");
    el.type = "text";
    fire(el, "change");
    expect(drain()[0]).toMatchObject({ sensitive: true });
  });

  it("the sticky mark clears on change: a later, ordinary edit of the same element is not sensitive", () => {
    const el = mount(`<input id="t" type="password" aria-label="Field">`, "t") as HTMLInputElement;
    fire(el, "input");
    el.type = "text";
    fire(el, "change");
    fire(el, "change");
    expect(drain().map((e) => e.sensitive)).toEqual([true, false]);
  });

  it("the sticky mark clears on focusout too", () => {
    const el = mount(`<input id="t" type="password" aria-label="Field">`, "t") as HTMLInputElement;
    fire(el, "input");
    el.type = "text";
    fire(el, "focusout");
    fire(el, "change");
    expect(drain()[0]).toMatchObject({ sensitive: false });
  });

  it("a file input change is recorded sensitive: replay gates it on a human, never a variable", () => {
    const el = mount(`<input id="t" type="file" aria-label="Attachment">`, "t");
    fire(el, "change");
    expect(drain()[0]).toMatchObject({ type: "type", name: "Attachment", sensitive: true });
  });
});
