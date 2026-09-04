// S-02 / S-09 — the shared perception core: the ONE role / name / visibility
// implementation that both the isolated-world library (`agentLib.ts`) and the
// page-world recorder shim (`recorderShim.src.js`) execute. These tests run the
// raw asset bytes, so what is tested is what ships in both worlds.
import { describe, it, expect, beforeEach } from "vitest";
import { AGENT_CORE_SRC } from "./agentCore";

interface Core {
  norm(s: unknown): string;
  role(el: Element): string | null;
  name(el: Element): string;
  nameFull(el: Element): string;
  hidden(el: Element): boolean;
  hiddenBy(el: Element): "hidden" | "inert" | null;
  disabled(el: Element): boolean;
  checked(el: Element): boolean;
  isFileInput(el: Element): boolean;
  all(root: Node): Element[];
  unreachable(all: Element[]): { closedShadowRoots: number; frames: number };
}

const core = new Function(
  `${AGENT_CORE_SRC}\nreturn {norm:__vmarkNorm,role:__vmarkRole,name:__vmarkName,nameFull:__vmarkNameFull,` +
    `hidden:__vmarkHidden,hiddenBy:__vmarkHiddenBy,disabled:__vmarkDisabled,checked:__vmarkChecked,` +
    `isFileInput:__vmarkIsFileInput,all:__vmarkAll,unreachable:__vmarkUnreachable};`,
)() as Core;

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}
function el(html: string): Element {
  return parse(html).body.firstElementChild!;
}
/** The asset with every comment removed, so a word in prose cannot trip a code check. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the asset's discipline", () => {
  it("declares only functions at the top level — no statements, no side effects", () => {
    const topLevel = codeOnly(AGENT_CORE_SRC)
      .split("\n")
      .filter((line) => /^\S/.test(line));
    expect(topLevel.length).toBeGreaterThan(10);
    for (const line of topLevel) expect(line).toMatch(/^(function __vmark[A-Za-z]+\(|\}\s*$)/);
  });

  it("every function is __vmark-prefixed, so nothing collides with a page's globals", () => {
    const names = [...codeOnly(AGENT_CORE_SRC).matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(10);
    for (const n of names) expect(n).toMatch(/^__vmark/);
  });

  it("is ES5 and standalone: no let/const/class/arrow/template/import/export", () => {
    expect(codeOnly(AGENT_CORE_SRC)).not.toMatch(/\b(let|const|class|import|export)\b|=>|`/);
  });

  it("never reads a field's value — the recorder shim ships these bytes", () => {
    expect(AGENT_CORE_SRC).not.toContain(".value");
  });
});

describe("__vmarkNorm (S-09)", () => {
  it("collapses whitespace and trims", () => {
    expect(core.norm("  Close\n\t dialog  ")).toBe("Close dialog");
  });
  it("NFC-normalises, so composed and decomposed spellings are one name", () => {
    expect(core.norm("café")).toBe("café");
  });
  it.each([
    ["zero-width space", "Publ\u200Bish", "Publish"],
    ["zero-width joiner/non-joiner", "Pub\u200Cli\u200Dsh", "Publish"],
    ["bidi override pair", "\u202EPublish\u202C", "Publish"],
    ["word joiner / invisible operators", "Pub\u2060li\u2064sh", "Publish"],
    ["BOM", "\uFEFFPublish", "Publish"],
    ["soft hyphen", "Pub\u00ADlish", "Publish"],
  ])("strips %s", (_label, input, expected) => {
    expect(core.norm(input)).toBe(expected);
  });
  it("keeps CJK and RTL text intact", () => {
    expect(core.norm(" 发布 ")).toBe("发布");
    expect(core.norm("نشر")).toBe("نشر");
  });
  it("tolerates null/undefined/non-strings", () => {
    expect(core.norm(null)).toBe("");
    expect(core.norm(undefined)).toBe("");
    expect(core.norm(42)).toBe("42");
  });
});

describe("__vmarkRole", () => {
  it.each([
    ["text", "textbox"],
    ["email", "textbox"],
    ["password", "textbox"],
    ["tel", "textbox"],
    ["url", "textbox"],
    ["color", "textbox"],
    ["date", "textbox"],
    ["file", "textbox"],
    ["search", "searchbox"],
    ["number", "spinbutton"],
    ["range", "slider"],
    ["checkbox", "checkbox"],
    ["radio", "radio"],
    ["submit", "button"],
    ["button", "button"],
    ["reset", "button"],
    ["image", "button"],
  ])("input type=%s → %s", (type, role) => {
    expect(core.role(el(`<input type="${type}">`))).toBe(role);
  });
  it("input type=hidden has no role; a type attribute is case-insensitive", () => {
    expect(core.role(el(`<input type="hidden">`))).toBeNull();
    expect(core.role(el(`<input type="CHECKBOX">`))).toBe("checkbox");
  });
  it.each([
    [`<a href="/x">x</a>`, "link"],
    [`<a>x</a>`, null],
    [`<summary>x</summary>`, "button"],
    [`<nav></nav>`, "navigation"],
    [`<main></main>`, "main"],
    [`<h4>x</h4>`, "heading"],
    [`<select></select>`, "combobox"],
    [`<select size="3"></select>`, "listbox"],
    [`<img alt="x">`, "img"],
    [`<div role="  Region ">x</div>`, "region"],
    [`<div role="none">x</div>`, null],
    [`<span>x</span>`, null],
  ])("%s → %s", (html, role) => {
    expect(core.role(el(html))).toBe(role);
  });
});

describe("__vmarkName", () => {
  it("follows accname precedence: labelledby → aria-label → label → placeholder → value", () => {
    const doc = parse(
      `<span id="l">Ref</span>` +
        `<input id="a" aria-labelledby="l" aria-label="Direct">` +
        `<input id="b" aria-label="Direct" placeholder="Hint">` +
        `<label for="c">Lab</label><input id="c" placeholder="Hint">` +
        `<input id="d" placeholder="Hint">` +
        `<input id="e" type="submit" value="Send">`,
    );
    const names = ["a", "b", "c", "d", "e"].map((id) => core.name(doc.getElementById(id)!));
    expect(names).toEqual(["Ref", "Direct", "Lab", "Hint", "Send"]);
  });

  it("a labelledby reference uses the referenced element's aria-label before its text, and is not followed further", () => {
    const doc = parse(
      `<span id="x" aria-label="Alpha" aria-labelledby="y">x-text</span><span id="y">Beta</span>` +
        `<button aria-labelledby="x">z</button>`,
    );
    expect(core.name(doc.querySelector("button")!)).toBe("Alpha");
  });

  it("a hidden labelledby reference still contributes its text", () => {
    const doc = parse(`<span id="h" hidden>Hidden label</span><button aria-labelledby="h">z</button>`);
    expect(core.name(doc.querySelector("button")!)).toBe("Hidden label");
  });

  it("name from content skips hidden descendants and script/style, and includes image alt", () => {
    expect(core.name(el(`<button>Save <span hidden>draft</span><span aria-hidden="true">*</span></button>`))).toBe("Save");
    expect(core.name(el(`<button>Go<style>.x{}</style><script>1</script></button>`))).toBe("Go");
    expect(core.name(el(`<button><img alt="Download"></button>`))).toBe("Download");
    expect(core.name(el(`<button>a<br>b</button>`))).toBe("a b");
  });

  it("falls back to title, and to alt for images", () => {
    expect(core.name(el(`<div role="button" title="Tip"></div>`))).toBe("Tip");
    expect(core.name(el(`<img alt="Logo">`))).toBe("Logo");
    expect(core.name(el(`<img title="T">`))).toBe("");
  });

  it("keeps CJK and RTL names", () => {
    expect(core.name(el(`<button>发布</button>`))).toBe("发布");
    expect(core.name(el(`<button dir="rtl">نشر</button>`))).toBe("نشر");
  });

  it("normalises every source (S-09): the same name whether typed plainly or with format characters", () => {
    expect(core.name(el(`<button>Publ\u200Bish</button>`))).toBe(core.name(el(`<button>Publish</button>`)));
    expect(core.name(el(`<button aria-label="\u202Eevil\u202C">x</button>`))).toBe("evil");
  });

  it.each([
    [`<nav>Home About Contact</nav>`, ""],
    [`<nav aria-label="Primary">Home About</nav>`, "Primary"],
    [`<main title="Content">Long body text</main>`, "Content"],
    [`<div role="region">Sidebar text</div>`, ""],
    [`<div role="form" aria-label="Checkout">fields</div>`, "Checkout"],
    [`<div role="search">Search box text</div>`, ""],
    [`<header role="banner">Site header text</header>`, ""],
    [`<div role="complementary" aria-label="Related">links</div>`, "Related"],
    [`<footer role="contentinfo">© 2026</footer>`, ""],
  ])("landmarks are named by label/labelledby/title only (S-06): %s → %j", (html, name) => {
    expect(core.name(el(html))).toBe(name);
  });

  it("caps the name at 200 characters; __vmarkNameFull keeps the whole thing", () => {
    const long = "x".repeat(250);
    const b = el(`<button>${long}</button>`);
    expect(core.name(b)).toHaveLength(200);
    expect(core.nameFull(b)).toHaveLength(250);
  });
});

describe("__vmarkHiddenBy / __vmarkHidden", () => {
  it.each([
    [`<button hidden>x</button>`, "hidden"],
    [`<div aria-hidden="true"><button>x</button></div>`, "hidden"],
    [`<div style="display:none"><button>x</button></div>`, "hidden"],
    [`<div style="visibility:hidden"><button>x</button></div>`, "hidden"],
    [`<div inert><button>x</button></div>`, "inert"],
    [`<div inert><div hidden><button>x</button></div></div>`, "hidden"],
    [`<div hidden><div inert><button>x</button></div></div>`, "hidden"],
    [`<button>x</button>`, null],
  ])("%s → %s", (html, why) => {
    const doc = parse(html);
    const b = doc.querySelector("button")!;
    expect(core.hiddenBy(b)).toBe(why);
    expect(core.hidden(b)).toBe(why !== null);
  });
});

describe("__vmarkDisabled / __vmarkChecked / __vmarkIsFileInput", () => {
  it("reads live state and inherited disablement", () => {
    const doc = parse(`<fieldset disabled><button>x</button></fieldset><input type="checkbox" checked><div role="button" disabled></div>`);
    expect(core.disabled(doc.querySelector("button")!)).toBe(true);
    expect(core.disabled(doc.querySelector("[role=button]")!)).toBe(true);
    const cb = doc.querySelector("input") as HTMLInputElement;
    expect(core.checked(cb)).toBe(true);
    cb.checked = false;
    expect(core.checked(cb)).toBe(false);
  });
  it("identifies file inputs case-insensitively and nothing else", () => {
    expect(core.isFileInput(el(`<input type="FILE">`))).toBe(true);
    expect(core.isFileInput(el(`<input type="text">`))).toBe(false);
    expect(core.isFileInput(el(`<button>file</button>`))).toBe(false);
  });
});

describe("__vmarkAll — the composed tree (S-05)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("walks descendants in document order and dives into OPEN shadow roots before light children", () => {
    document.body.innerHTML = `<div id="host"><span id="light">l</span></div><p id="after">p</p>`;
    const host = document.getElementById("host")!;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<button id="inner">i</button><slot></slot>`;
    const ids = core.all(document.body).map((e) => e.id || e.tagName.toLowerCase());
    expect(ids).toEqual(["host", "inner", "slot", "light", "after"]);
  });

  it("does not see into a closed root, and counts its host as unreachable", () => {
    document.body.innerHTML = `<x-closed id="c"></x-closed><x-light></x-light><x-open></x-open><iframe></iframe><div></div>`;
    document.getElementById("c")!.attachShadow({ mode: "closed" }).innerHTML = `<button>secret</button>`;
    document.querySelector("x-open")!.attachShadow({ mode: "open" }).innerHTML = `<button>open</button>`;
    const all = core.all(document.body);
    expect(all.some((e) => e.textContent === "secret")).toBe(false);
    expect(all.some((e) => e.textContent === "open")).toBe(true);
    // A closed root is undetectable by definition; the count is the custom-element
    // hosts that expose no open root — the only place one can hide. `x-light` has no
    // shadow tree at all and is counted too: this is a ceiling for custom elements,
    // and a `<div>` with a closed root is not counted. Pinned so the contract is explicit.
    expect(core.unreachable(all)).toEqual({ closedShadowRoots: 2, frames: 1 });
  });

  it("a hidden host hides everything in its shadow tree (the walk crosses the boundary upward)", () => {
    document.body.innerHTML = `<div id="host" hidden></div>`;
    const root = document.getElementById("host")!.attachShadow({ mode: "open" });
    root.innerHTML = `<button id="inner">i</button>`;
    expect(core.hidden(root.getElementById("inner")!)).toBe(true);
  });

  it("aria-labelledby resolves against the element's own tree (a shadow root has its own ids)", () => {
    document.body.innerHTML = `<span id="lbl">Outer</span><div id="host"></div>`;
    const root = document.getElementById("host")!.attachShadow({ mode: "open" });
    root.innerHTML = `<span id="lbl">Inner</span><button aria-labelledby="lbl">x</button>`;
    expect(core.name(root.querySelector("button")!)).toBe("Inner");
  });

  it("accepts a Document root and an empty root", () => {
    document.body.innerHTML = `<button>x</button>`;
    expect(core.all(document).some((e) => e.tagName === "BUTTON")).toBe(true);
    expect(core.all(document.createElement("div"))).toEqual([]);
  });
});
