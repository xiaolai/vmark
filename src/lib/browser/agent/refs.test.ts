// WI-P2.1 / WI-P2.2 — stable element refs, scoped to the navigation generation
// (ADR-A2). Refs are stable across reads within one committed view and reset when
// the generation changes — including a same-document (SPA) navigation that keeps
// the document but replaces the view (Audit #11) — so a ref minted against the old
// view cannot resolve against the new one.
import { describe, it, expect } from "vitest";
import { refFor, queryByRef } from "./refs";

function docWith(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}

describe("refFor", () => {
  it("assigns monotonic refs in call order (e1, e2, …)", () => {
    const doc = docWith(`<button id="a">A</button><button id="b">B</button>`);
    expect(refFor(doc.getElementById("a")!, 1)).toBe("e1");
    expect(refFor(doc.getElementById("b")!, 1)).toBe("e2");
  });

  it("returns the SAME ref for an element across repeated reads at one generation", () => {
    const doc = docWith(`<button id="a">A</button>`);
    const a = doc.getElementById("a")!;
    const first = refFor(a, 3);
    refFor(doc.createElement("div"), 3);
    expect(refFor(a, 3)).toBe(first);
  });

  it("gives distinct elements distinct refs", () => {
    const doc = docWith(`<a href="/" id="a">A</a><a href="/" id="b">B</a>`);
    expect(refFor(doc.getElementById("a")!, 1)).not.toBe(refFor(doc.getElementById("b")!, 1));
  });
});

describe("queryByRef", () => {
  it("resolves a ref back to its element", () => {
    const doc = docWith(`<button id="a">A</button>`);
    const a = doc.getElementById("a")!;
    expect(queryByRef(doc, refFor(a, 1), 1)).toBe(a);
  });

  it("returns null for an unknown ref", () => {
    expect(queryByRef(docWith(`<button>A</button>`), "e99", 1)).toBeNull();
  });

  it("returns null once the element has left the document (a stale handle)", () => {
    const doc = docWith(`<button id="a">A</button>`);
    const a = doc.getElementById("a")!;
    const ref = refFor(a, 1);
    a.remove();
    expect(queryByRef(doc, ref, 1)).toBeNull();
  });
});

describe("generation scoping (navigation resets the store)", () => {
  it("a new document restarts refs and cannot resolve the old page's ref", () => {
    const page1 = docWith(`<button id="a">A</button>`);
    const a = page1.getElementById("a")!;
    expect(refFor(a, 1)).toBe("e1");

    const page2 = docWith(`<button id="z">Z</button>`);
    const z = page2.getElementById("z")!;
    expect(refFor(z, 1)).toBe("e1");
    expect(queryByRef(page2, "e1", 1)).toBe(z);
    expect(queryByRef(page1, "e1", 1)).toBe(a);
  });

  it("a SAME-document generation bump resets the store, so an old ref no longer resolves", () => {
    // The document is unchanged (an SPA route change), but the generation moved:
    // the old view's refs must not survive into the new view.
    const doc = docWith(`<button id="a">Old</button>`);
    const a = doc.getElementById("a")!;
    const oldRef = refFor(a, 5);
    expect(queryByRef(doc, oldRef, 5)).toBe(a);

    // Generation bumps (same document). The store resets; the old ref is gone.
    expect(queryByRef(doc, oldRef, 6)).toBeNull();
    // New refs start fresh at the new generation.
    expect(refFor(doc.getElementById("a")!, 6)).toBe("e1");
  });
});
