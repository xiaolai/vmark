// S-05 / S-06 — the snapshot's shape, reach (shadow DOM, frames) and bounds,
// plus the other walks (query, wait_for, click) through open shadow roots.
import { describe, it, expect, beforeEach } from "vitest";
import { buildSnapshotScript, buildClickScript, buildWaitConditionScript } from "./actScript";
import { buildQueryScript } from "./powerScript";
import { ariaSnapshot, SNAPSHOT_NODE_CAP, SNAPSHOT_VISIT_BUDGET, type AriaSnapshot } from "./aria";

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}
function exec(doc: Document, script: string): unknown {
  return JSON.parse(new Function("document", script)(doc) as string);
}
function snapshot(doc: Document, gen = 0): AriaSnapshot {
  return exec(doc, buildSnapshotScript(gen)) as AriaSnapshot;
}

describe("snapshot shape", () => {
  it("returns {nodes, truncated, unreachable} — never a bare array", () => {
    const snap = snapshot(parse(`<button>Go</button>`));
    expect(snap).toEqual({
      nodes: [{ role: "button", name: "Go", ref: "e1" }],
      truncated: false,
      unreachable: { closedShadowRoots: 0, frames: 0 },
    });
  });
});

describe("shadow DOM and frames (S-05)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete (document as unknown as { __vmarkRefStore?: unknown }).__vmarkRefStore;
  });

  function host(shadowHtml: string, lightHtml = ""): HTMLElement {
    document.body.innerHTML = `<div id="host">${lightHtml}</div>`;
    const h = document.getElementById("host")!;
    h.attachShadow({ mode: "open" }).innerHTML = shadowHtml;
    return h;
  }

  it("perceives through an open shadow root, shadow tree before light children", () => {
    host(`<button id="in">Inner</button><slot></slot>`, `<button id="out">Outer</button>`);
    const snap = snapshot(document);
    expect(snap.nodes.map((n) => n.name)).toEqual(["Inner", "Outer"]);
    expect(snap.unreachable).toEqual({ closedShadowRoots: 0, frames: 0 });
  });

  it("acts through an open shadow root", () => {
    const h = host(`<button id="in">Inner</button>`);
    let clicked = false;
    h.shadowRoot!.getElementById("in")!.addEventListener("click", () => (clicked = true));
    expect(exec(document, buildClickScript("button", "Inner"))).toEqual({ found: true, clicked: true, matchedTotal: 1, matchedVisible: 1 });
    expect(clicked).toBe(true);
  });

  it("counts frames and custom-element hosts with no open root as unreachable", () => {
    document.body.innerHTML = `<iframe></iframe><iframe></iframe><x-closed id="c"></x-closed><x-light></x-light><x-open id="o"></x-open>`;
    document.getElementById("c")!.attachShadow({ mode: "closed" }).innerHTML = `<button>secret</button>`;
    document.getElementById("o")!.attachShadow({ mode: "open" }).innerHTML = `<button>open</button>`;
    const snap = snapshot(document);
    expect(snap.nodes.map((n) => n.name)).toEqual(["open"]);
    expect(snap.unreachable).toEqual({ closedShadowRoots: 2, frames: 2 });
  });

  it("a hidden host hides its shadow content from the snapshot", () => {
    host(`<button>Inner</button>`).setAttribute("hidden", "");
    expect(snapshot(document).nodes).toEqual([]);
  });

  it("the mirror agrees on the composed order (parity)", () => {
    host(`<button>Inner</button><slot></slot>`, `<button>Outer</button>`);
    expect(snapshot(document).nodes).toEqual(ariaSnapshot(document.body));
  });

  it("wait_for matches a role inside an open shadow root and returns a ref", () => {
    host(`<button>Continue</button>`);
    const res = exec(document, buildWaitConditionScript({ role: "button", name: "Continue" }, 2)) as { matched: boolean; ref?: string };
    expect(res.matched).toBe(true);
    expect(res.ref).toMatch(/^e\d+$/);
  });

  it("wait_for matches text rendered inside an open shadow root", () => {
    host(`<p>Order confirmed</p>`);
    expect(exec(document, buildWaitConditionScript({ text: "confirmed" }, 1))).toEqual({ matched: true });
    expect(exec(document, buildWaitConditionScript({ text: "absent" }, 1))).toEqual({ matched: false });
  });

  it("query finds elements inside open shadow roots and counts them", () => {
    host(`<button class="x">Inner</button>`, `<button class="x">Outer</button>`);
    const res = exec(document, buildQueryScript("button.x", 1)) as { count: number; elements: Array<{ text: string }> };
    expect(res.count).toBe(2);
    expect(res.elements.map((e) => e.text)).toEqual(["Inner", "Outer"]);
  });
});

describe("snapshot bounds (S-06)", () => {
  it("caps nodes at 2000 and says so", () => {
    expect(SNAPSHOT_NODE_CAP).toBe(2000);
    const doc = parse(Array.from({ length: 2001 }, (_, i) => `<button>b${i}</button>`).join(""));
    const snap = snapshot(doc);
    expect(snap.nodes).toHaveLength(2000);
    expect(snap.truncated).toBe(true);
    expect(ariaSnapshot(doc.body)).toHaveLength(2000);
  });

  it("exactly 2000 nodes is not truncated", () => {
    const doc = parse(Array.from({ length: 2000 }, (_, i) => `<button>b${i}</button>`).join(""));
    const snap = snapshot(doc);
    expect(snap.nodes).toHaveLength(2000);
    expect(snap.truncated).toBe(false);
  });

  it("caps a name at 200 chars, says so, and the capped name still targets the element", () => {
    const long = "n".repeat(250);
    const doc = parse(`<button id="b">${long}</button>`);
    const snap = snapshot(doc);
    expect(snap.nodes[0].name).toBe(long.slice(0, 200));
    expect(snap.truncated).toBe(true);
    let clicked = false;
    doc.getElementById("b")!.addEventListener("click", () => (clicked = true));
    expect(exec(doc, buildClickScript("button", snap.nodes[0].name))).toMatchObject({ clicked: true });
    expect(clicked).toBe(true);
  });

  it("a 200-char name is not truncation", () => {
    const snap = snapshot(parse(`<button>${"n".repeat(200)}</button>`));
    expect(snap.truncated).toBe(false);
  });

  it("landmarks take their name from label/labelledby/title only, never from content", () => {
    const doc = parse(
      `<nav>Home About Contact</nav><nav aria-label="Primary">Home</nav><main>Body text</main>` +
        `<div role="region" title="Side">stuff</div><div role="form">fields</div><div role="search" aria-label="Site">s</div>` +
        `<header role="banner">Banner text</header><aside role="complementary">Aside</aside><footer role="contentinfo">Foot</footer>`,
    );
    const byRole = snapshot(doc).nodes.map((n) => `${n.role}=${n.name}`);
    expect(byRole).toEqual([
      "navigation=",
      "navigation=Primary",
      "main=",
      "region=Side",
      "form=",
      "search=Site",
      "banner=",
      "complementary=",
      "contentinfo=",
    ]);
  });
});

// #103 — the injected snapshot walks the page LAZILY and within a visit budget: a
// cursor per open node (children read by index), never a copied child list or an
// array of every element, and it gives up after SNAPSHOT_VISIT_BUDGET elements and
// says so. The mirror has the same property (aria.test.ts); this is the core.
describe("snapshot walk budget (#103)", () => {
  /** Make `doc.children` a list a billion wide whose index reads are counted, and
   *  which throws once read past `limit` — the old walk copied the whole list, so it
   *  fails fast here instead of hanging the run. */
  function billionWide(doc: Document, limit: number, make: () => Element, reads: number[]): void {
    const kids = new Proxy(
      {},
      {
        get(_t, key) {
          if (key === "length") return 1_000_000_000;
          const i = typeof key === "string" ? Number(key) : NaN;
          if (!Number.isInteger(i)) return undefined;
          reads.push(i);
          if (reads.length > limit) throw new Error(`read past the budget: ${reads.length} reads`);
          return make();
        },
      },
    );
    Object.defineProperty(doc, "children", { configurable: true, get: () => kids });
  }

  it("a document a billion elements wide is visited at most SNAPSHOT_VISIT_BUDGET+1 times, still fills the node cap, and is truncated", () => {
    const doc = parse("");
    const reads: number[] = [];
    billionWide(
      doc,
      SNAPSHOT_VISIT_BUDGET + 1,
      () => {
        const b = doc.createElement("button");
        b.textContent = "b";
        return b;
      },
      reads,
    );
    const snap = snapshot(doc);
    expect(snap.nodes).toHaveLength(SNAPSHOT_NODE_CAP);
    expect(snap.truncated).toBe(true);
    expect(reads.length).toBeLessThanOrEqual(SNAPSHOT_VISIT_BUDGET + 1);
  });

  it("running out of visit budget with nothing perceivable is still truncated: the page was not all seen", () => {
    const doc = parse("");
    const reads: number[] = [];
    billionWide(doc, SNAPSHOT_VISIT_BUDGET + 1, () => doc.createElement("i"), reads);
    expect(snapshot(doc)).toEqual({ nodes: [], truncated: true, unreachable: { closedShadowRoots: 0, frames: 0 } });
    // It looked at the whole budget before giving up — not one element more.
    expect(reads.length).toBeGreaterThanOrEqual(SNAPSHOT_VISIT_BUDGET);
    expect(reads.length).toBeLessThanOrEqual(SNAPSHOT_VISIT_BUDGET + 1);
  });

  it("a capped NAME does not stop the walk: every later node is still emitted, and truncated says so", () => {
    const snap = snapshot(parse(`<button>${"n".repeat(250)}</button><button>after</button><a href="/x">link</a>`));
    expect(snap.nodes.map((n) => n.name)).toEqual(["n".repeat(200), "after", "link"]);
    expect(snap.truncated).toBe(true);
  });

  it("the unreachable tally still covers the whole reachable page after the node cap", () => {
    const doc = parse(`${Array.from({ length: SNAPSHOT_NODE_CAP + 1 }, () => `<button>b</button>`).join("")}<iframe></iframe><x-late></x-late>`);
    const snap = snapshot(doc);
    expect(snap.nodes).toHaveLength(SNAPSHOT_NODE_CAP);
    expect(snap.truncated).toBe(true);
    expect(snap.unreachable).toEqual({ closedShadowRoots: 1, frames: 1 });
  });
});
