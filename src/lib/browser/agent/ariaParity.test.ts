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
import { describe, it, expect, beforeEach, vi } from "vitest";
import { AGENT_CORE_SRC } from "./agentCore";
import { computeRole, accessibleName, ariaSnapshot, SNAPSHOT_VISIT_BUDGET } from "./aria";
import { CONTENT_BUDGET, NAME_CAP, CONTENT_VISIT_BUDGET, ID_LIST_MAX } from "./ariaName";

interface Core {
  role(el: Element): string | null;
  name(el: Element): string;
  all(root: Node): Element[];
  visitBudget(): number;
  contentBudget(): number;
}
const core = new Function(
  `${AGENT_CORE_SRC}\nreturn {role:__vmarkRole,name:__vmarkName,all:__vmarkAll,` +
    `visitBudget:__vmarkVisitBudget,contentBudget:__vmarkContentBudget};`,
)() as Core;

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
    <h2 role="presentation" aria-busy="true">Busy keeps heading</h2>
    <h2 role="presentation" aria-current="page">Current keeps heading</h2>
    <h2 role="presentation" aria-checked="true">Non-global does not</h2>
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
    <button>${"\u202E".repeat(3200)}Bidi flood</button>
    <button>${"x".repeat(NAME_CAP * 40)}<span>tail</span></button>
    <button>${"<i></i>".repeat(4000)}Wide list</button>
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

describe("content visit budget parity (#105/#119)", () => {
  it("both sides stop after CONTENT_VISIT_BUDGET nodes, so a million empty spans cannot pin the walk", () => {
    const m = /function __vmarkContentVisitBudget\(\) \{\n {2}return (\d+);/.exec(AGENT_CORE_SRC);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(CONTENT_VISIT_BUDGET);
    const host = document.createElement("button");
    let reads = 0;
    const kids = new Proxy([] as Node[], {
      get(t, key) {
        if (key === "length") return 1_000_000_000;
        const i = typeof key === "string" ? Number(key) : NaN;
        if (!Number.isInteger(i)) return Reflect.get(t, key);
        reads += 1;
        return document.createElement("span"); // empty: contributes no characters
      },
    }) as unknown as NodeListOf<ChildNode>;
    Object.defineProperty(host, "childNodes", { value: kids });
    const started = Date.now();
    expect(accessibleName(host)).toBe("");
    expect(reads).toBeLessThanOrEqual(CONTENT_VISIT_BUDGET + 1);
    expect(core.name(host)).toBe("");
    expect(reads).toBeLessThanOrEqual(2 * (CONTENT_VISIT_BUDGET + 1));
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

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
    // The hostile content shapes (#105): a format-character flood before the
    // name, a node far past the cap, and a very wide child list.
    expect(names).toContain("Bidi flood");
    expect(names).toContain("x".repeat(NAME_CAP));
    expect(names).toContain("Wide list");
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

/** A child list a billion wide whose index reads are counted — and which throws
 *  once read past `limit`, so a walk that copies the whole list or recurses over it
 *  fails fast instead of hanging the run. */
function billionWide(limit: number, make: (i: number) => Node, reads: number[]): unknown {
  return new Proxy(
    {},
    {
      get(_t, key) {
        if (key === "length") return 1_000_000_000;
        const i = typeof key === "string" ? Number(key) : NaN;
        if (!Number.isInteger(i)) return undefined;
        reads.push(i);
        if (reads.length > limit) throw new Error(`read past the budget: ${reads.length} reads`);
        return make(i);
      },
    },
  );
}

// Rounds 3–4 (#103 / #105): the two sides must not only agree on a hostile page,
// they must agree while allocating the same bounded amount — the mirror's budgets
// and the core's are the same numbers, and both walks are cursors over live child
// lists that stop at those numbers.
describe("budget parity", () => {
  it("the composed walk's visit budget is ONE number: the asset text and aria.ts agree", () => {
    const match = /function __vmarkVisitBudget\(\) \{\n {2}return (\d+);/.exec(AGENT_CORE_SRC);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(SNAPSHOT_VISIT_BUDGET);
    expect(core.visitBudget()).toBe(SNAPSHOT_VISIT_BUDGET);
  });

  it("the id-list cap is ONE number: the core and ariaName.ts agree (#105 round 5)", () => {
    const match = /function __vmarkIdListMax\(\) \{\n {2}return (\d+);/.exec(AGENT_CORE_SRC);
    expect(match, "__vmarkIdListMax() must return a literal").not.toBeNull();
    expect(Number(match![1])).toBe(ID_LIST_MAX);
  });

  it("the content budget is ONE number: the core and ariaName.ts agree", () => {
    expect(core.contentBudget()).toBe(CONTENT_BUDGET);
  });

  it("__vmarkAll is a bounded consumer of the walk: a billion-child root yields SNAPSHOT_VISIT_BUDGET elements after at most budget+1 reads", () => {
    const reads: number[] = [];
    const root = { children: billionWide(SNAPSHOT_VISIT_BUDGET + 1, () => document.createElement("i"), reads) } as unknown as Element;
    expect(core.all(root)).toHaveLength(SNAPSHOT_VISIT_BUDGET);
    expect(reads.length).toBeLessThanOrEqual(SNAPSHOT_VISIT_BUDGET + 1);
  });
});

describe("hostile content walks agree and stay bounded (#105)", () => {
  const sides: Array<[string, (el: Element) => string]> = [
    ["aria.ts", accessibleName],
    ["core", core.name],
  ];

  it.each(sides)("%s: a button a billion text children wide is named from the first CONTENT_BUDGET characters, reading no more", (_side, name) => {
    const reads: number[] = [];
    const btn = document.createElement("button");
    Object.defineProperty(btn, "childNodes", {
      get: () => billionWide(CONTENT_BUDGET + 1, () => document.createTextNode("x"), reads),
    });
    expect(name(btn)).toBe("x".repeat(NAME_CAP));
    expect(reads.length).toBeLessThanOrEqual(CONTENT_BUDGET + 1);
  });

  it.each(sides)("%s: a text node holding megabytes is stripped a window at a time — no replace ever runs over the whole node", (_side, name) => {
    const btn = document.createElement("button");
    btn.appendChild(document.createTextNode(`${"\u200B".repeat(CONTENT_BUDGET)}${"y".repeat(5_000_000)}`));
    const original = String.prototype.replace;
    const receivers: number[] = [];
    const spy = vi.spyOn(String.prototype, "replace").mockImplementation(function (this: string, ...args: unknown[]) {
      receivers.push(this.length);
      return (original as unknown as (...a: unknown[]) => string).apply(this, args);
    });
    try {
      expect(name(btn)).toBe("y".repeat(NAME_CAP));
    } finally {
      spy.mockRestore();
    }
    expect(receivers.length).toBeGreaterThan(0);
    expect(Math.max(...receivers)).toBeLessThanOrEqual(CONTENT_BUDGET);
  });
});
