// S-02 — one perception algorithm, two hosts.
//
// `aria.ts` is the TypeScript mirror (the workflow engine types against it and
// the jsdom suites read pages through it); `agentCore.src.js` is what runs in
// the page's isolated world and inside the recorder shim. The mirror cannot
// EXECUTE the core: VMark's own webview ships `script-src 'self'` with no
// 'unsafe-eval', so a `new Function` over the asset would throw in production.
// It therefore stays a separate implementation, and THIS is the contract that
// keeps it the same algorithm: element by element over a widened fixture, role
// and accessible name must be identical. A drift here means the AI's
// unit-tested view and its real view have diverged.
import { describe, it, expect, beforeEach } from "vitest";
import { AGENT_CORE_SRC } from "./agentCore";
import { computeRole, accessibleName, ariaSnapshot } from "./aria";

interface Core {
  role(el: Element): string | null;
  name(el: Element): string;
  all(root: Node): Element[];
}
const core = new Function(`${AGENT_CORE_SRC}\nreturn {role:__vmarkRole,name:__vmarkName,all:__vmarkAll};`)() as Core;

/** The `actScript.test.ts` fixture plus every shape the audit named. */
const WIDE_FIXTURE = `
  <nav><a href="/">Home</a><a>no href</a></nav>
  <nav aria-label="Footer links"><a href="/a">A</a></nav>
  <main title="Body">
    <h1>Title</h1>
    <h3 id="sub">Sub</h3>
    <div role="heading" aria-level="5">Custom</div>
    <div role="presentation">decoration</div>
    <div role="none">deco</div>
    <div role="button link" title="Multi token">t</div>
    <div role="  BUTTON  ">Spaced case</div>
    <div role="bogus button">Unknown first token</div>
    <button role="none">Focusable keeps its role</button>
    <a href="/x" role="presentation">Focusable link keeps its role</a>
    <div role="constructor">Prototype key</div>
    <h2 role="none" aria-label="Global prop keeps heading">x</h2>
    <div contenteditable="true"><span>Descendant is not a textbox</span></div>
    <div contenteditable="false">Not editable</div>
    <div contenteditable="">Editable host</div>
    <p id="lbl">Save changes</p>
    <button aria-labelledby="lbl">x</button>
    <p id="lbl2">Referenced name</p>
    <button aria-labelledby="lbl2" aria-label="Direct name">combined</button>
    <span id="c1" aria-label="Chain A" aria-labelledby="c2">c1 text</span><span id="c2">Chain B</span>
    <button aria-labelledby="c1 lbl2">chained</button>
    <span id="hid" hidden>Hidden ref</span><button aria-labelledby="hid">h</button>
    <button aria-labelledby="missing" aria-label="Fallback">f</button>
    <button>Save <span hidden>draft</span><span aria-hidden="true">*</span><span style="display:none">gone</span></button>
    <button><img alt="Download"></button>
    <button>a<br>b<script>1</script><style>.x{}</style></button>
    <button disabled>Disabled</button>
    <button aria-label="Close   dialog">x</button>
    <button aria-label="Publ\u200Bish">z</button>
    <button>\u202EOverridden\u202C</button>
    <button>café</button>
    <button>发布</button>
    <button dir="rtl">نشر التغييرات</button>
    <fieldset disabled><button>In fieldset</button></fieldset>
    <label for="e">Email</label><input id="e" type="text">
    <label>Wrapped <input type="password"></label>
    <label for="e">(work)</label>
    <input type="submit" value="Send it">
    <input type="submit">
    <input type="image" src="/go.png" alt="Go">
    <input type="image" src="/go.png">
    <input type="number" aria-label="Qty">
    <input type="search" aria-label="Find">
    <input type="range" aria-label="Volume">
    <input type="hidden" value="csrf">
    <input type="checkbox" checked aria-label="Agree">
    <input type="radio" aria-label="Pick">
    <input type="email" placeholder="you@example.com">
    <input type="tel" title="Phone">
    <input type="url">
    <input type="password" placeholder="Secret">
    <input type="date" aria-label="When">
    <input type="color" aria-label="Tint">
    <input type="file" aria-label="Attachment">
    <input type="button" value="Plain">
    <input type="reset" value="Reset it">
    <input type="text" placeholder="Search\tthe   docs">
    <div role="checkbox" aria-checked="true" aria-label="Terms"></div>
    <select aria-label="Country"><option>Japan</option></select>
    <select multiple aria-label="Tags"></select>
    <select size="4"><option>x</option></select>
    <textarea placeholder="Say  something"></textarea>
    <img src="/x.png" alt="Company  logo">
    <img src="/y.png" title="Titled">
    <img src="/z.png">
    <summary>More details</summary>
    <details><summary aria-label="Expand">+</summary>content</details>
    <a href="#" title="Only title"></a>
    <a href="/x"><span>Nested</span> <b>bold</b></a>
    <div role="region">Region content</div>
    <div role="region" aria-label="Sidebar">Region content</div>
    <div role="form">form content</div>
    <div role="search" title="Site search">s</div>
    <header role="banner">Banner text</header>
    <aside role="complementary">Aside text</aside>
    <footer role="contentinfo">Footer text</footer>
    <div role="button" title="Helpful\n tip"></div>
    <div role="textbox" aria-label="Fake">x</div>
    <button>${"long ".repeat(60)}</button>
    <div hidden><button>Ghost</button></div>
    <div aria-hidden="true"><h2>Ghost heading</h2></div>
    <div style="display: none"><button>Ghost css</button></div>
    <div inert><button>Inert</button></div>
  </main>`;

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}

function describeEl(e: Element): string {
  return e.outerHTML.slice(0, 80);
}

describe("aria.ts ⇔ agentCore.src.js parity", () => {
  it("agrees on role and accessible name for EVERY element of the widened fixture", () => {
    const doc = parse(WIDE_FIXTURE);
    const elements = Array.from(doc.body.querySelectorAll("*"));
    expect(elements.length).toBeGreaterThan(80);
    const mismatches: string[] = [];
    for (const e of elements) {
      const mirror = [computeRole(e), accessibleName(e)];
      const injected = [core.role(e), core.name(e)];
      if (JSON.stringify(mirror) !== JSON.stringify(injected)) {
        mismatches.push(`${describeEl(e)} → aria.ts ${JSON.stringify(mirror)} vs core ${JSON.stringify(injected)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("the fixture exercises what it claims: names with CJK, RTL, format characters and a landmark", () => {
    const doc = parse(WIDE_FIXTURE);
    const names = Array.from(doc.body.querySelectorAll("*")).map((e) => accessibleName(e));
    expect(names).toContain("发布");
    expect(names).toContain("نشر التغييرات");
    expect(names).toContain("Publish");
    expect(names).toContain("Overridden");
    expect(names).toContain("caf\u00E9");
    expect(names).toContain("Footer links");
    expect(names).toContain("Chain A Referenced name");
  });

  describe("inside an open shadow root", () => {
    beforeEach(() => {
      document.body.innerHTML = "";
      delete (document as unknown as { __vmarkRefStore?: unknown }).__vmarkRefStore;
    });

    it("walks the same composed order and agrees on every node", () => {
      document.body.innerHTML = `<div id="host"><button>Light</button></div><button>After</button>`;
      const root = document.getElementById("host")!.attachShadow({ mode: "open" });
      root.innerHTML = `<span id="l">Shadow label</span><button aria-labelledby="l">s</button><slot></slot>`;
      const injected = core.all(document.body);
      const mirror = ariaSnapshot(document.body);
      expect(mirror.map((n) => n.name)).toEqual(["Shadow label", "Light", "After"]);
      const injectedNodes = injected
        .map((e) => [core.role(e), core.name(e)] as const)
        .filter(([role]) => role !== null)
        .map(([role, name]) => ({ role, name }));
      expect(mirror.map(({ role, name }) => ({ role, name }))).toEqual(injectedNodes);
    });
  });
});

// The two resolvers recognize ONE role vocabulary. The page script cannot import
// it, so the list is spelled twice — and pinned here.
describe("role vocabulary parity", () => {
  it("agentCore.src.js and ariaRole.ts recognize the same roles", async () => {
    const { KNOWN_ROLES } = await import("./ariaRole");
    const match = /function __vmarkKnownRoles\(\) \{\n {2}return (\[[^\]]*\]);/.exec(AGENT_CORE_SRC);
    expect(match).not.toBeNull();
    const inCore = JSON.parse(match![1]) as string[];
    expect([...inCore].sort()).toEqual([...KNOWN_ROLES].sort());
  });
});
