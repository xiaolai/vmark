// WI-P2.1 — stable element refs backed by a per-document store (ADR-A2).
// Productionizes the Phase-0 probe (dev-docs/grills/browser-automation/probe-refs.mjs):
// refs are stable across repeated reads within one document and reset when a new
// document (a navigation) replaces it, so a ref cannot leak across pages.
import { describe, it, expect } from "vitest";
import { refFor, queryByRef } from "./refs";

function docWith(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}

describe("refFor", () => {
  it("assigns monotonic refs in call order (e1, e2, …)", () => {
    const doc = docWith(`<button id="a">A</button><button id="b">B</button>`);
    const a = doc.getElementById("a")!;
    const b = doc.getElementById("b")!;
    expect(refFor(a)).toBe("e1");
    expect(refFor(b)).toBe("e2");
  });

  it("returns the SAME ref for an element across repeated reads", () => {
    const doc = docWith(`<button id="a">A</button>`);
    const a = doc.getElementById("a")!;
    const first = refFor(a);
    // Touch another element, then re-read the first: its ref must not move.
    refFor(doc.createElement("div"));
    expect(refFor(a)).toBe(first);
  });

  it("gives distinct elements distinct refs", () => {
    const doc = docWith(`<a href="/" id="a">A</a><a href="/" id="b">B</a>`);
    const refA = refFor(doc.getElementById("a")!);
    const refB = refFor(doc.getElementById("b")!);
    expect(refA).not.toBe(refB);
  });
});

describe("queryByRef", () => {
  it("resolves a ref back to its element", () => {
    const doc = docWith(`<button id="a">A</button>`);
    const a = doc.getElementById("a")!;
    const ref = refFor(a);
    expect(queryByRef(doc, ref)).toBe(a);
  });

  it("returns null for an unknown ref", () => {
    const doc = docWith(`<button>A</button>`);
    expect(queryByRef(doc, "e99")).toBeNull();
  });

  it("returns null once the element has left the document (a stale handle)", () => {
    const doc = docWith(`<button id="a">A</button>`);
    const a = doc.getElementById("a")!;
    const ref = refFor(a);
    a.remove();
    expect(queryByRef(doc, ref)).toBeNull();
  });
});

describe("per-document isolation (navigation resets the store)", () => {
  it("a new document restarts refs at e1 and cannot resolve the old page's ref", () => {
    const page1 = docWith(`<button id="a">A</button>`);
    const a = page1.getElementById("a")!;
    expect(refFor(a)).toBe("e1");

    // A navigation replaces the document; its store is fresh.
    const page2 = docWith(`<button id="z">Z</button>`);
    const z = page2.getElementById("z")!;
    expect(refFor(z)).toBe("e1");
    // The new document's store never held the old page's element.
    expect(queryByRef(page2, "e1")).toBe(z);
    expect(queryByRef(page1, "e1")).toBe(a);
  });
});
