// WI-1.1 / R1 — patchBrowserTab: canonical url invariant + referential no-ops
import { describe, it, expect } from "vitest";
import { patchBrowserTab, makeBrowserTab } from "./tabStoreBrowser";
import type { Tab } from "./tabStoreTypes";

const doc: Tab = {
  kind: "document",
  id: "doc-1",
  filePath: "/a.md",
  title: "a.md",
  isPinned: false,
} as Tab;

function tabs(): Record<string, Tab[]> {
  return {
    w1: [doc, makeBrowserTab("b1", "https://example.com/", "Example")],
    w2: [makeBrowserTab("b2", "https://other.example/", "Other")],
  };
}

describe("patchBrowserTab — applies the patch", () => {
  it("updates url, title, scrollY and the navigation generation", () => {
    const next = patchBrowserTab(tabs(), "b1", {
      url: "https://example.com/next",
      title: "Next",
      scrollY: 120,
      generation: 3,
    });
    expect(next.w1[1]).toMatchObject({
      url: "https://example.com/next",
      title: "Next",
      scrollY: 120,
      generation: 3,
    });
  });

  it("canonicalizes a url patch (the stored url is the dedup key — WI-1.1)", () => {
    // A redirect/self-driven navigation reports the raw URL; storing it raw would
    // break dedup ("is this URL already open?") and the canonical-storage invariant.
    const next = patchBrowserTab(tabs(), "b1", { url: "https://EXAMPLE.com:443/a#frag" });
    expect((next.w1[1] as { url: string }).url).toBe("https://example.com/a");
  });

  it("keeps a non-canonicalizable url as-is (about:blank still opens)", () => {
    const next = patchBrowserTab(tabs(), "b1", { url: "about:blank" });
    expect((next.w1[1] as { url: string }).url).toBe("about:blank");
  });

  it("never converts a document tab into a browser tab", () => {
    const next = patchBrowserTab(tabs(), "doc-1", { url: "https://evil.example/" });
    expect(next.w1[0]).toBe(doc);
    expect("url" in next.w1[0]).toBe(false);
  });
});

describe("patchBrowserTab — no-ops keep referential identity (no store-wide rerenders)", () => {
  it("returns the SAME tabs object for an unknown id", () => {
    const before = tabs();
    expect(patchBrowserTab(before, "missing", { title: "x" })).toBe(before);
  });

  it("returns the SAME tabs object for a document-tab id", () => {
    const before = tabs();
    expect(patchBrowserTab(before, "doc-1", { title: "x" })).toBe(before);
  });

  it("returns the SAME tabs object for an empty patch", () => {
    const before = tabs();
    expect(patchBrowserTab(before, "b1", {})).toBe(before);
  });

  it("returns the SAME tabs object when every patched value is unchanged", () => {
    const before = tabs();
    expect(patchBrowserTab(before, "b1", { url: "https://example.com/", title: "Example" })).toBe(
      before,
    );
  });

  it("leaves untouched windows referentially identical", () => {
    const before = tabs();
    const next = patchBrowserTab(before, "b1", { title: "Changed" });
    expect(next).not.toBe(before);
    expect(next.w2).toBe(before.w2); // the other window never re-renders
    expect(next.w1[0]).toBe(before.w1[0]); // the sibling document tab is untouched
  });
});
