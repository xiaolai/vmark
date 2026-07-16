// WI-P5.1 / WI-P5.2 — injected DOM-detection (query) + CSS-manipulation (style)
// scripts. Isolated-world DOM operations reusing the agent lib.
import { describe, it, expect } from "vitest";
import { buildQueryScript, buildStyleScript } from "./powerScript";

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}
function exec(doc: Document, script: string): unknown {
  return JSON.parse(new Function("document", "window", script)(doc, doc.defaultView) as string);
}

describe("buildQueryScript (WI-P5.1)", () => {
  it("returns structured data for matching elements, each with a ref", () => {
    const doc = parse(`<button>A</button><button>B</button><p>x</p>`);
    const res = exec(doc, buildQueryScript("button", 1)) as {
      count: number;
      elements: Array<{ ref: string; tag: string; text: string }>;
    };
    expect(res.count).toBe(2);
    expect(res.elements).toHaveLength(2);
    expect(res.elements[0]).toMatchObject({ tag: "button", text: "A" });
    expect(res.elements[0].ref).toMatch(/^e\d+$/);
  });

  it("includes attributes when requested", () => {
    const doc = parse(`<a href="/x" data-id="7">link</a>`);
    const res = exec(doc, buildQueryScript("a", 1, { attributes: true })) as {
      elements: Array<{ attributes: Record<string, string> }>;
    };
    expect(res.elements[0].attributes).toMatchObject({ href: "/x", "data-id": "7" });
  });

  it("reports an invalid selector rather than throwing", () => {
    const doc = parse(`<p>x</p>`);
    const res = exec(doc, buildQueryScript(">>bad", 1)) as { error?: string };
    expect(res.error).toBe("invalid-selector");
  });
});

describe("buildStyleScript (WI-P5.2)", () => {
  it("sets inline styles on elements matching a selector", () => {
    const doc = parse(`<div class="overlay">x</div>`);
    const res = exec(doc, buildStyleScript({ selector: ".overlay" }, 1, { set: { display: "none" } })) as {
      found: boolean;
      styled: boolean;
    };
    expect(res).toMatchObject({ found: true, styled: true });
    expect((doc.querySelector(".overlay") as HTMLElement).style.display).toBe("none");
  });

  it("toggles classes", () => {
    const doc = parse(`<div id="d" class="a">x</div>`);
    exec(doc, buildStyleScript({ selector: "#d" }, 1, { addClasses: ["b"], removeClasses: ["a"] }));
    const el = doc.getElementById("d")!;
    expect(el.classList.contains("b")).toBe(true);
    expect(el.classList.contains("a")).toBe(false);
  });

  it("targets by ref and refuses a stale ref", () => {
    const doc = parse(`<div id="d">x</div>`);
    // Mint a ref via query at generation 2.
    const ref = (exec(doc, buildQueryScript("#d", 2)) as { elements: Array<{ ref: string }> }).elements[0].ref;
    expect(exec(doc, buildStyleScript({ ref }, 2, { set: { color: "red" } }))).toMatchObject({ found: true });
    // A generation bump invalidates the ref.
    expect(exec(doc, buildStyleScript({ ref }, 3, { set: { color: "red" } }))).toMatchObject({ found: false });
  });

  it("injects a scoped <style> block", () => {
    const doc = parse(`<main>x</main>`);
    const res = exec(doc, buildStyleScript({}, 1, { injectCss: ".hidden{display:none}" })) as { injected: boolean };
    expect(res.injected).toBe(true);
    expect(doc.querySelector("style")?.textContent).toContain(".hidden");
  });
});
