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

  it("records a click on a <label> once, as its control — not again for the activation click (#122)", () => {
    evalIsolated(buildArmScript());
    const label = mount<HTMLLabelElement>(`<label id="l" for="cb">Agree</label><input id="cb" type="checkbox">`, "l");
    label.click(); // the browser then fires the control's own activation click
    const events = drain();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "click", role: "checkbox", name: "Agree" });
  });

  it("a contenteditable edit is recorded as a type on the editing host when focus leaves it (#123)", () => {
    evalIsolated(buildArmScript());
    const host = mount(`<div id="ed" contenteditable="true" aria-label="Body"><p>draft</p></div>`, "ed");
    host.focus();
    host.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "x" }));
    fire(host, "focusout");
    const events = drain();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "type", role: "textbox", name: "Body" });
    expect(JSON.stringify(events[0])).not.toContain("draft");
  });

  // Audit 20260907 round 2: the dirty flag was set whether or not the shim was
  // armed, so text typed BEFORE the recording started was committed as a step
  // the moment focus left — an action the session never saw the user perform.
  it("does not record a contenteditable edit that began before the session was armed", () => {
    evalIsolated(buildDisarmScript()); // the outer beforeEach armed it
    const host = mount(`<div id="ed" contenteditable="true" aria-label="Body"></div>`, "ed");
    host.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "x" }));
    evalIsolated(buildArmScript());
    fire(host, "focusout");
    expect(drain()).toEqual([]);
  });

  it("does not record a contenteditable edit that began in an EARLIER armed session", () => {
    evalIsolated(buildArmScript());
    const host = mount(`<div id="ed" contenteditable="true" aria-label="Body"></div>`, "ed");
    host.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "x" }));
    evalIsolated(buildDisarmScript());
    evalIsolated(buildArmScript()); // a new recording, a new marker element
    fire(host, "focusout");
    expect(drain()).toEqual([]);
  });

  it("a click on a WRAPPING label's text resolves to the control inside it, recorded once", () => {
    evalIsolated(buildArmScript());
    const label = mount<HTMLLabelElement>(`<label id="l">Agree <input id="cb" type="checkbox"></label>`, "l");
    label.click();
    const events = drain();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "click", role: "checkbox", name: "Agree" });
  });

  it("a click on a CHILD of a label (a span) resolves to the label's control, recorded once", () => {
    evalIsolated(buildArmScript());
    mount(`<label id="l" for="cb"><span id="txt">Agree</span></label><input id="cb" type="checkbox">`, "l");
    document.getElementById("txt")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const events = drain();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "click", role: "checkbox", name: "Agree" });
  });

  it("a CANCELLED label click never swallows a later genuine click on its control", async () => {
    evalIsolated(buildArmScript());
    const label = mount<HTMLLabelElement>(`<label id="l" for="cb">Agree</label><input id="cb" type="checkbox">`, "l");
    label.addEventListener("click", (e) => e.preventDefault()); // no activation click follows
    label.click();
    await new Promise((r) => setTimeout(r, 0)); // the next task: the arm has died
    (document.getElementById("cb") as HTMLInputElement).click();
    expect(drain()).toHaveLength(2);
  });

  it("two rapid direct clicks on the same control are two actions (only a label activation is folded)", () => {
    evalIsolated(buildArmScript());
    const cb = mount<HTMLInputElement>(`<input id="cb" type="checkbox" aria-label="Agree">`, "cb");
    cb.click();
    cb.click();
    expect(drain()).toHaveLength(2);
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

// Audit 20260907 round 2: the walk stopped at ANY role attribute, so a
// decorative icon inside a button was recorded instead of the button — and a
// presentational role resolves to NO role, which degrades the recorded step to
// a manual `confirm:`.
describe("recorder shim — the walk stops at an ACTIONABLE control", () => {
  beforeEach(() => evalIsolated(buildArmScript()));

  it.each(["presentation", "none", "img"])(
    "walks past a decorative role=%s inside a button",
    (role) => {
      const btn = mount(
        `<button id="b" aria-label="Save changes"><span id="i" role="${role}">icon</span></button>`,
        "b",
      );
      expect(btn).not.toBeNull();
      document.getElementById("i")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(drain()[0]).toMatchObject({ type: "click", role: "button", name: "Save changes" });
    },
  );

  it("still stops at an actionable role on a non-native element", () => {
    const el = mount(`<div id="d" role="button" aria-label="Send">x</div>`, "d");
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(drain()[0]).toMatchObject({ type: "click", role: "button", name: "Send" });
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

  it("stays ES5: no let/const/class/arrow/template, and no trailing comma in a call (#776)", () => {
    // The header's "self-contained ES5" was already false in five places — a
    // trailing comma in an argument list is ES2017. It parses in WebKit, so
    // nothing failed; the claim simply stopped being true, which is how the
    // next real violation would have gone unnoticed too.
    const code = RECORDER_SHIM_BODY.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\b(let|const|class|import|export)\b|=>|`/);
    expect(code).not.toMatch(/,\s*\)/);
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

  // Audit 20260907 round 2: the stamp alone was not enough. A page that DELETES
  // the buffer element after a clearing drain gets a fresh one whose stamp is
  // "" — equal to the "" this closure still held, because no capture had run
  // since the drain to observe the real stamp — so the drained events were
  // republished and the host counted them twice.
  it("a buffer element the page replaced after a drain does not republish the drained events", () => {
    const a = mount(`<button id="a">A</button><button id="b">B</button>`, "a");
    a.click();
    expect(drain(true)).toHaveLength(1);
    document.getElementById(RECORDER_BUFFER_ID)!.remove();
    document.getElementById("b")!.click();
    expect(drain(true)).toEqual([{ type: "click", role: "button", name: "B" }]);
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

  // Audit 20260907 (#391, round 2): the classifier matched English identifier
  // tokens only, so a field named ONLY in one of the other shipped languages —
  // 验证码, パスワード, Contraseña — was recorded as plain `{input}` text.
  // CJK has no word boundaries and the ASCII tokenizer splits accented words,
  // so these match as whole phrases of the lowercased name.
  it.each([
    ["zh-CN aria-label 验证码", `aria-label="验证码"`],
    ["zh-CN placeholder 请输入密码", `placeholder="请输入密码"`],
    ["zh-TW aria-label 驗證碼", `aria-label="驗證碼"`],
    ["ja aria-label パスワード", `aria-label="パスワード"`],
    ["ja placeholder 暗証番号", `placeholder="暗証番号"`],
    ["ko aria-label 비밀번호", `aria-label="비밀번호"`],
    ["ko aria-label 인증번호 입력", `aria-label="인증번호 입력"`],
    ["de aria-label Passwort", `aria-label="Passwort"`],
    ["es aria-label Contraseña (accented)", `aria-label="Contraseña"`],
    ["es decomposed accent (NFD)", `aria-label="Contraseña"`],
    ["fr aria-label Mot de passe", `aria-label="Mot de passe"`],
    ["it aria-label Codice di verifica", `aria-label="Codice di verifica"`],
    ["pt-BR placeholder Senha", `placeholder="Senha"`],
  ])("marks a field named in %s sensitive (#391)", (_label, attrs) => {
    expect(changed(attrs)).toMatchObject({ type: "type", sensitive: true });
  });

  it("a <label for> that names the field 驗證碼 marks it sensitive", () => {
    document.body.innerHTML = `<label for="c">驗證碼</label><input id="c" type="text">`;
    fire(document.getElementById("c")!, "change");
    expect(drain()[0]).toMatchObject({ type: "type", name: "驗證碼", sensitive: true });
  });

  it.each([
    ["a zh-CN email field", `aria-label="邮箱"`],
    ["a ja name field", `aria-label="お名前"`],
    ["a ko search field", `aria-label="검색"`],
    ["a de postal code — a bare code word is not a secret", `aria-label="Postleitzahl"`],
    ["an es postal code", `aria-label="Código postal"`],
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

  // The two tests that stood here pinned the EPISODE mark's clearing as the
  // observable outcome — `[true, false]` across a second commit, `false` after a
  // focusout — which was the audit's open residual spelled out as an expectation:
  // a password field flipped to text became `{input}` material on its next commit.
  // The element is the secret; the episode mark still clears, but a permanent
  // per-element mark now carries the observation (WI-FL6.4). The full matrix —
  // later commit, focus leaving for the eye button, a flip before first touch, the
  // attribute spelling, and the no-false-positive case — is
  // `recorderShim.residuals.test.ts`; this keeps the one-line statement here.
  it("a field once seen as a password field stays sensitive on every later commit, across a type flip and a focusout", () => {
    const el = mount(`<input id="t" type="password" aria-label="Field">`, "t") as HTMLInputElement;
    fire(el, "input");
    el.type = "text";
    fire(el, "change");
    fire(el, "focusout");
    fire(el, "change");
    expect(drain().map((e) => e.sensitive)).toEqual([true, true]);
  });

  // Audit 20260907 (#393): a classifier failure used to fail OPEN — the field
  // read as non-sensitive and its value was recorded as an `{input}` variable.
  // At a sensitivity boundary a failure is a secret. Only the classifier reads
  // `autocomplete` (the locator names the field by its <label>), so a page
  // handing back a non-string there breaks the classifier alone — and does so
  // for every shim instance listening, which keeps the probe order-independent.
  it("a classifier that cannot read the field records it sensitive (fail closed)", () => {
    document.body.innerHTML = `<label for="mystery">Mystery</label><input type="text" id="mystery">`;
    const el = document.getElementById("mystery") as HTMLInputElement;
    const native = el.getAttribute.bind(el);
    Object.defineProperty(el, "getAttribute", {
      value: (name: string) => (name === "autocomplete" ? { broken: true } : native(name)),
    });
    fire(el, "change");
    expect(drain()[0]).toMatchObject({ type: "type", name: "Mystery", sensitive: true });
  });

  it("a file input change is recorded sensitive: replay gates it on a human, never a variable", () => {
    const el = mount(`<input id="t" type="file" aria-label="Attachment">`, "t");
    fire(el, "change");
    expect(drain()[0]).toMatchObject({ type: "type", name: "Attachment", sensitive: true });
  });
});

// Audit 20260907 (#391, round 3): the phrase list covered the other shipped
// languages, but English fields are named by PHRASES too — "Verification code",
// "Security code" — and none of their words is a sensitive TOKEN on its own
// (a bare "code" is a postal code as often as a secret), so they were recorded
// as ordinary `{input}` text.
describe("recorder shim — English phrases that name a secret (#391)", () => {
  beforeEach(() => evalIsolated(buildArmScript()));

  function changed(attrs: string): Recorded {
    document.body.innerHTML = `<input type="text" ${attrs}>`;
    fire(document.querySelector("input")!, "change");
    return drain()[0];
  }

  it.each([
    ["aria-label Verification code", `aria-label="Verification code"`],
    ["placeholder Security code", `placeholder="Security code"`],
    ["aria-label One-time code", `aria-label="One-time code"`],
    ["aria-label Confirmation code", `aria-label="Confirmation code"`],
    ["aria-label Authentication code", `aria-label="Authentication code"`],
    ["aria-label Verification Code in Title Case", `aria-label="Verification Code"`],
    ["aria-label Passphrase", `aria-label="Passphrase"`],
    ["aria-label Recovery code", `aria-label="Recovery code"`],
    ["aria-label Backup code", `aria-label="Backup code"`],
  ])("marks a field named %s sensitive", (_label, attrs) => {
    expect(changed(attrs)).toMatchObject({ type: "type", sensitive: true });
  });

  it("a <label for> sentence containing the phrase marks the field", () => {
    document.body.innerHTML = `<label for="c">Enter the verification code we sent you</label><input id="c" type="text">`;
    fire(document.getElementById("c")!, "change");
    expect(drain()[0]).toMatchObject({ type: "type", sensitive: true });
  });

  it.each([
    ["a postal code", `aria-label="Postal code"`],
    ["a zip code", `placeholder="ZIP code"`],
    ["a promo code", `aria-label="Promo code"`],
    ["a country code", `aria-label="Country code"`],
    ["a discount code", `aria-label="Discount code"`],
    ["an area code", `aria-label="Area code"`],
    ["a verification email address", `aria-label="Verification email"`],
  ])("does not mark %s sensitive — a bare code word is not a secret", (_label, attrs) => {
    expect(changed(attrs)).toMatchObject({ type: "type", sensitive: false });
  });
});

// Audit 20260907 round 2 — the observer's evidence has to be AVAILABLE when a
// commit is judged, and it has to cover every attribute the accessible name is
// built from. Both gaps let a page erase the only evidence that a field was a
// secret, without the shim noticing anything had happened.
describe("recorder shim — the observer's evidence reaches the commit", () => {
  beforeEach(() => evalIsolated(buildArmScript()));

  it("drains pending mutation records before judging a commit in the SAME task", () => {
    // A MutationObserver callback is a microtask, so a page that flips `type`
    // and commits synchronously — inside its own handler, then blur() — reached
    // the commit before the permanent mark existed. The field is never focused,
    // so no episode mark covers for it either.
    const el = mount<HTMLInputElement>(`<input id="t" type="password" aria-label="Nickname">`, "t");
    el.setAttribute("type", "text");
    fire(el, "change"); // same task: no microtask checkpoint in between
    expect(drain()[0]).toMatchObject({ type: "type", name: "Nickname", sensitive: true });
  });

  it("watches the placeholder, which the accessible name is built from", async () => {
    const el = mount<HTMLInputElement>(`<input id="t" type="text" placeholder="Password">`, "t");
    el.removeAttribute("placeholder"); // the evidence, erased before first focus
    await Promise.resolve();
    fire(el, "change");
    expect(drain()[0]).toMatchObject({ type: "type", sensitive: true });
  });

  it("watches aria-labelledby, which the accessible name is built from", async () => {
    document.body.innerHTML =
      `<span id="lbl">Password</span><input id="t" type="text" aria-labelledby="lbl">`;
    const el = document.getElementById("t")!;
    el.removeAttribute("aria-labelledby");
    await Promise.resolve();
    fire(el, "change");
    expect(drain()[0]).toMatchObject({ type: "type", sensitive: true });
  });
});

// Audit 20260907 (#393, round 2 — then round 2 of the 20260907 re-audit): the
// classifier failed closed, but the MARKS did not. Failing closed covered the
// patch that THROWS; it did nothing about the patch that lies. A page that
// replaces `WeakMap.prototype.set` with a silent no-op made every mark vanish
// with no error at all, so `marksBroken` never tripped and a password field
// committed after a `type` flip was recorded as ordinary — laundering a secret
// through the very mechanism meant to remember it.
//
// The shim now captures the PRISTINE map methods at document start, before any
// page script has run, so neither patch reaches the marks: the classification a
// page sees is the one the shim made. The fail-closed catches remain for a
// genuine failure; they are simply no longer the page's to trigger.
describe("recorder shim — the marks are out of the page's reach (#393)", () => {
  beforeEach(() => evalIsolated(buildArmScript()));

  const nativeGet = WeakMap.prototype.get;
  const nativeSet = WeakMap.prototype.set;
  afterEach(() => {
    WeakMap.prototype.get = nativeGet;
    WeakMap.prototype.set = nativeSet;
  });

  /** Break WeakMap reads for ONE element only, so jsdom's own maps keep working. */
  function poisonReadsFor(el: Element): void {
    WeakMap.prototype.get = function (this: WeakMap<object, unknown>, key: object) {
      if (key === el) throw new Error("poisoned read");
      return nativeGet.call(this, key);
    };
  }

  function poisonWritesFor(el: Element): void {
    WeakMap.prototype.set = function (this: WeakMap<object, unknown>, key: object, value: unknown) {
      if (key === el) throw new Error("poisoned write");
      return nativeSet.call(this, key, value);
    };
  }

  /** Break WeakMap writes SILENTLY — the patch that lies rather than throws. */
  function silenceWrites(): void {
    WeakMap.prototype.set = function (this: WeakMap<object, unknown>) {
      return this;
    };
  }

  it("a page that SILENTLY no-ops WeakMap writes cannot launder a password field", async () => {
    const el = mount<HTMLInputElement>(`<input id="t" type="password" aria-label="Nickname">`, "t");
    silenceWrites();
    fire(el, "focusin"); // markSensitive — the write is swallowed by the patch
    el.setAttribute("type", "text"); // the show-password flip
    await Promise.resolve(); // let the observer's own microtask run
    fire(el, "change");
    expect(drain()[0]).toMatchObject({ type: "type", name: "Nickname", sensitive: true });
  });

  it("a page that makes WeakMap reads THROW cannot change the classification either", () => {
    const el = mount(`<input id="t" type="text" aria-label="Nickname">`, "t");
    poisonReadsFor(el);
    fire(el, "change");
    expect(drain()[0]).toMatchObject({ type: "type", name: "Nickname", sensitive: false });
  });

  it("a page that makes WeakMap writes throw still does not launder a password", () => {
    const pw = mount(`<input id="pw" type="password" aria-label="Nickname">`, "pw");
    poisonWritesFor(pw);
    fire(pw, "focusin");
    WeakMap.prototype.set = nativeSet;
    fire(pw, "change");
    expect(drain()[0]).toMatchObject({ type: "type", name: "Nickname", sensitive: true });
  });

  it("with its marks intact the shim still records an ordinary field as not sensitive", () => {
    const el = mount(`<input id="t" type="text" aria-label="Nickname">`, "t");
    fire(el, "change");
    expect(drain()[0]).toMatchObject({ type: "type", name: "Nickname", sensitive: false });
  });
});

// Audit 20260907 (#393, round 3): the classifier and the marks failed closed,
// but the OBSERVER's setup still ended in an empty catch. The observer is the
// only thing that can see a page rewrite `type` (or launder `autocomplete`,
// `name`, `id`, `aria-label`) BEFORE the user ever touches the field — the case
// the permanent mark exists for — so a shim that could not install one has the
// same incomplete memory a broken WeakMap gives it, and must degrade the same
// way instead of going on reporting fields as ordinary.
describe("recorder shim — an observer that could not be installed fails closed (#393)", () => {
  beforeEach(() => evalIsolated(buildArmScript()));

  /** Install a fresh shim while the page's `MutationObserver` is `impostor`.
   *  The newest instance's listeners run last, so its verdict is the drained one. */
  function installShimWithObserver(impostor: unknown): void {
    const g = globalThis as unknown as { MutationObserver?: unknown };
    const native = g.MutationObserver;
    g.MutationObserver = impostor;
    try {
      installShim();
    } finally {
      g.MutationObserver = native;
    }
  }

  it("an observer whose observe() is refused degrades the shim: a later ordinary field is sensitive", () => {
    class RefusesToObserve {
      observe(): void {
        throw new Error("observe refused");
      }
    }
    installShimWithObserver(RefusesToObserve);
    const el = mount(`<input id="t" type="text" aria-label="Nickname">`, "t");
    fire(el, "change");
    expect(drain()[0]).toMatchObject({ type: "type", name: "Nickname", sensitive: true });
  });

  it("a page with no MutationObserver at all is the same degradation, not a silent skip", () => {
    installShimWithObserver(undefined);
    const el = mount(`<input id="t" type="text" aria-label="Nickname">`, "t");
    fire(el, "change");
    expect(drain()[0]).toMatchObject({ type: "type", name: "Nickname", sensitive: true });
  });
});
