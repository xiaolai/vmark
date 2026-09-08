// WI-FL6.4 — the three recorder residuals the 2026-09-03 embedded-browser audit left
// open (`dev-docs/audit/20260903-embedded-browser-ai-audit.md`, "Recorder
// sensitivity"), each pinned at the layer that owns it: the page-world shim executed
// byte-identical to what Rust injects, the trusted host-side redactor, and the
// host-owned session.
//
//   1. **A show-password toggle.** The buffer never holds a value, so what a `type`
//      flip could launder is the SENSITIVITY hint — and a laundered hint turns a
//      `confirm:` human gate into a `{input}` variable that an MCP argument supplies
//      at replay, which is the leak the audit named. The identity of a secret is the
//      ELEMENT, not its current `type`: a field observed as a password field at any
//      point in the document's life stays sensitive — across a later commit, across
//      focus leaving for the eye button, and when the flip happens before the user
//      ever touches the field (only an attribute mutation can see that one).
//   2. **`/reset/<token>`.** A credential-bearing path — the flow word in any of its
//      hyphen/underscore spellings, a token-shaped segment, or a JWT under an
//      ordinary word — keeps its origin and nothing else, in a recorded navigate and
//      in the entry URL alike.
//   3. **The entry navigate.** Recorded host-side at start so a replay begins where
//      the recording did; it precedes everything the page produced, and it passes
//      through the same redactor as every other URL.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RECORDER_SHIM_SRC, buildArmScript, buildRecorderDrainScript } from "./recorderShim";
import { recordingToWorkflow, type RecordedEvent } from "../workflow/recorder";
import {
  __resetRecorderSessions,
  startRecorderSession,
  stopRecorderSession,
  type RecorderDeps,
} from "@/services/workflow/recorderSession";

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
  return JSON.parse(evalIsolated<string>(buildRecorderDrainScript(true))).events;
}

/** Mount `html` in the body and return the element with `id`. */
function mount(html: string, id: string): HTMLInputElement {
  document.body.innerHTML = html;
  return document.getElementById(id) as HTMLInputElement;
}

function fire(el: Element, type: string): void {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

/** MutationObserver records are delivered as a microtask; let them land, as they
 *  would before the user's next event. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A password field whose LABEL the identifier rule cannot see — the realistic case,
 *  since most of the web's labels are not English: only `type` says it is a secret. */
const PASSWORD = `<input id="t" type="password" aria-label="Contraseña">`;

/** Host operations for a session that never talks to a page. */
function deps(drains: RecordedEvent[][] = []): RecorderDeps {
  return {
    rearm: async () => {},
    disarm: async () => {},
    drainOnce: async () => drains.shift() ?? [],
    schedule: () => () => {},
  };
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  installShim();
  evalIsolated(buildArmScript());
});

afterEach(() => {
  __resetRecorderSessions();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("residual 1 — a show-password toggle cannot launder the sensitivity hint", () => {
  it("flipped to text BEFORE the user ever touches the field (the eye clicked first): still sensitive", async () => {
    const pw = mount(PASSWORD, "t");
    pw.type = "text"; // the page's toggle, clicked before any typing
    await flush();
    pw.value = "hunter2";
    fire(pw, "focusin");
    fire(pw, "input");
    fire(pw, "change");
    const events = drain();
    expect(events[0]).toMatchObject({ type: "type", name: "Contraseña", sensitive: true });
    expect(JSON.stringify(events)).not.toContain("hunter2");
  });

  it("a second commit on the same field, after the flip, is still sensitive", () => {
    const pw = mount(PASSWORD, "t");
    fire(pw, "input");
    pw.type = "text";
    fire(pw, "change");
    fire(pw, "change");
    expect(drain().map((e) => e.sensitive)).toEqual([true, true]);
  });

  it("focus leaving for the eye button and coming back does not clear it", () => {
    const pw = mount(PASSWORD, "t");
    fire(pw, "focusin");
    fire(pw, "input");
    fire(pw, "change");
    fire(pw, "focusout"); // the toggle took focus…
    pw.type = "text"; // …and flipped the type
    fire(pw, "focusin");
    fire(pw, "input");
    fire(pw, "change");
    expect(drain().map((e) => e.sensitive)).toEqual([true, true]);
  });

  it("a flip the page makes with no user interaction at all (a remembered 'show' preference) still marks the field", async () => {
    const pw = mount(PASSWORD, "t");
    pw.setAttribute("type", "text"); // the attribute spelling of the same flip
    await flush();
    fire(pw, "change");
    expect(drain()[0]).toMatchObject({ sensitive: true });
  });

  it("an unrelated type change on an ordinary field marks nothing", async () => {
    const el = mount(`<input id="t" type="text" aria-label="Contact">`, "t");
    el.type = "email";
    await flush();
    fire(el, "focusin");
    fire(el, "change");
    expect(drain()[0]).toMatchObject({ type: "type", name: "Contact", sensitive: false });
  });

  it("the shim still never reads a value — the hint is the only thing it decides", () => {
    expect(RECORDER_SHIM_SRC).not.toContain(".value");
  });

  it("what the hint decides downstream: a human gate, never an {input} an MCP argument could supply", () => {
    const gated = recordingToWorkflow(
      [{ type: "type", role: "textbox", name: "Password", sensitive: true }],
      { site: "s" },
    );
    expect(gated.source).toContain('confirm: enter "Password"');
    expect(gated.inputs).toEqual([]);
    // What a laundered hint would have produced — the leak, spelled out.
    const laundered = recordingToWorkflow(
      [{ type: "type", role: "textbox", name: "Password", sensitive: false }],
      { site: "s" },
    );
    expect(laundered.source).toContain("action: type {Password} into");
    expect(laundered.inputs).toEqual(["Password"]);
  });
});

// Audit 20260907 (#391/#392/#394) — three gaps in the sensitivity hint:
//   #394 the permanent observer watched `type` alone, so a page that removed or
//        renamed `autocomplete`, `name`, `id` or `aria-label` before the first
//        focus laundered an otherwise-sensitive field;
//   #391 a field named only by its <label>, aria-labelledby or placeholder was
//        invisible to the identifier rule — the recorder already computes that
//        accessible name for the locator, and now reads it here too;
//   #392 the no-WeakMap fallback wrote enumerable `__vmark*` properties onto
//        page-owned elements; every engine VMark ships has WeakMap, so the
//        fallback is gone and the page never sees a mark.
describe("attribute laundering before the first interaction (#394)", () => {
  it.each([
    ["autocomplete removed", `<input id="t" type="text" autocomplete="current-password" aria-label="Contraseña">`, (el: HTMLInputElement) => el.removeAttribute("autocomplete")],
    ["autocomplete rewritten", `<input id="t" type="text" autocomplete="one-time-code" aria-label="Código">`, (el: HTMLInputElement) => el.setAttribute("autocomplete", "off")],
    ["name rewritten", `<input id="t" type="text" name="user_password" aria-label="Contraseña">`, (el: HTMLInputElement) => el.setAttribute("name", "q")],
    ["name removed", `<input id="t" type="text" name="otpCode" aria-label="Código">`, (el: HTMLInputElement) => el.removeAttribute("name")],
    ["aria-label rewritten", `<input id="t" type="text" aria-label="OTP code">`, (el: HTMLInputElement) => el.setAttribute("aria-label", "Code")],
  ])("%s: the field stays sensitive", async (_label, html, launder) => {
    const el = mount(html, "t");
    launder(el);
    await flush();
    fire(el, "focusin");
    fire(el, "input");
    fire(el, "change");
    expect(drain()[0]).toMatchObject({ type: "type", sensitive: true });
  });

  it("an attribute that BECOMES sensitive marks the field too, before any interaction", async () => {
    const el = mount(`<input id="t" type="text" aria-label="Contact">`, "t");
    el.setAttribute("autocomplete", "cc-number");
    el.setAttribute("autocomplete", "off"); // …and is laundered again straight after
    await flush();
    fire(el, "change");
    expect(drain()[0]).toMatchObject({ sensitive: true });
  });

  it("an unrelated attribute change on an ordinary field marks nothing", async () => {
    const el = mount(`<input id="t" type="text" name="query" aria-label="Contact">`, "t");
    el.setAttribute("name", "search");
    await flush();
    fire(el, "focusin");
    fire(el, "change");
    expect(drain()[0]).toMatchObject({ type: "type", name: "Contact", sensitive: false });
  });
});

describe("a field named only by its accessible name (#391)", () => {
  it.each([
    ["a <label for>", `<label for="t">One-time passcode</label><input id="t" type="text">`],
    ["a wrapping <label>", `<label>Security PIN <input id="t" type="text"></label>`],
    ["aria-labelledby", `<span id="l">Card CVV</span><input id="t" type="text" aria-labelledby="l">`],
    ["a placeholder", `<input id="t" type="text" placeholder="Enter your password">`],
  ])("%s marks the field sensitive", (_label, html) => {
    const el = mount(html, "t");
    fire(el, "focusin");
    fire(el, "input");
    fire(el, "change");
    expect(drain()[0]).toMatchObject({ type: "type", sensitive: true });
  });

  it("an ordinary label stays ordinary", () => {
    const el = mount(`<label for="t">Search</label><input id="t" type="text">`, "t");
    fire(el, "focusin");
    fire(el, "change");
    expect(drain()[0]).toMatchObject({ type: "type", name: "Search", sensitive: false });
  });
});

describe("the page never sees a mark (#392)", () => {
  it("the shim writes no __vmark* property onto page elements", () => {
    expect(RECORDER_SHIM_SRC).not.toMatch(/__vmark(Sensitive|EverSecret)/);
    const el = mount(PASSWORD, "t");
    fire(el, "focusin");
    fire(el, "input");
    expect(Object.keys(el).filter((k) => k.startsWith("__vmark"))).toEqual([]);
  });
});

const HEX_TOKEN = "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

function navigateTo(url: string): string {
  return recordingToWorkflow([{ type: "navigate", url }], { site: "s" }).source;
}

describe("residual 2 — /reset/<token> and its relatives keep the origin only", () => {
  it.each([
    ["/reset/<hex>", `https://a.example/reset/${HEX_TOKEN}`],
    ["a trailing slash", `https://a.example/reset/${HEX_TOKEN}/`],
    ["the flow word mid-path", `https://a.example/account/password/reset/${HEX_TOKEN}`],
    ["capitalised", `https://a.example/Reset/${HEX_TOKEN}`],
    ["reset-password", `https://a.example/reset-password/${HEX_TOKEN}`],
    ["password-reset (Discourse)", `https://a.example/u/password-reset/${HEX_TOKEN}`],
    ["password_reset with a SHORT token (GitHub's spelling)", "https://a.example/password_reset/a1b2c3"],
    ["reset_password", "https://a.example/reset_password/x9y8"],
    ["verify-email", "https://a.example/verify-email/x7"],
    ["a Django uid + token pair", "https://a.example/reset/MQ/bxs4q7-4f2c1a9e0b3d5f7a8c2e1d0b9f3a"],
    ["a JWT under an ordinary word", `https://a.example/session/${JWT}`],
    ["a token-shaped segment with no flow word", `https://a.example/account/${HEX_TOKEN}/settings`],
  ])("%s", (_label, url) => {
    const source = navigateTo(url);
    expect(source).toContain("1. action: navigate to https://a.example\n");
    expect(source).not.toContain(new URL(url).pathname);
    expect(source).not.toContain(HEX_TOKEN);
    expect(source).not.toContain("eyJ");
  });

  it.each([
    "https://a.example/blog/2026/09/post-title",
    "https://a.example/docs/getting-started",
    "https://a.example/authors/jane", // `authors` is not `auth`
    "https://a.example/tokens", // `tokens` is not `token`
    "https://a.example/oauth-guide", // `oauth` is not `auth`
  ])("an ordinary path is kept: %s", (url) => {
    expect(navigateTo(url)).toContain(`1. action: navigate to ${url}\n`);
  });

  it("a query-string token on an ordinary path: the query goes, the path stays", () => {
    expect(navigateTo("https://a.example/inbox?token=abc#access_token=x")).toContain(
      "1. action: navigate to https://a.example/inbox\n",
    );
  });

  it("the ENTRY url on a reset page is redacted the same way", async () => {
    startRecorderSession({
      tabId: "t",
      site: "s",
      generation: 1,
      startUrl: `https://a.example/reset/${HEX_TOKEN}?token=q#t`,
      deps: deps(),
    });
    const result = await stopRecorderSession("t");
    expect(result!.source).toContain("1. action: navigate to https://a.example\n");
    expect(result!.source).not.toContain(HEX_TOKEN);
  });
});

describe("residual 3 — the entry navigate is recorded", () => {
  it("is the workflow's first step, stripped to origin + path", async () => {
    startRecorderSession({
      tabId: "t",
      site: "s",
      generation: 1,
      startUrl: "https://a.example/app/inbox?session=abc#access_token=x",
      deps: deps(),
    });
    const result = await stopRecorderSession("t");
    expect(result!.source).toContain("1. action: navigate to https://a.example/app/inbox\n");
    expect(result!.source).not.toMatch(/session=|access_token/);
    expect(result!.eventCount).toBe(1);
  });

  it("precedes everything the page produced", async () => {
    startRecorderSession({
      tabId: "t",
      site: "s",
      generation: 1,
      startUrl: "https://a.example/compose",
      deps: deps([[{ type: "click", role: "button", name: "Send" }]]),
    });
    const result = await stopRecorderSession("t");
    expect(result!.source).toContain(
      '1. action: navigate to https://a.example/compose\n2. action: click "Send" (button)',
    );
    expect(result!.eventCount).toBe(2);
  });
});
