// Phase 6 — Slidev deck detection (§3bis), incl. false-positive regression set.
import { describe, it, expect } from "vitest";
import { detectSlidevDeck, extractHeadmatter } from "./detect";

describe("detectSlidevDeck — positive signals", () => {
  it("detects a Slidev-only headmatter key (theme is weak, mdc is strong)", () => {
    expect(detectSlidevDeck("---\nmdc: true\n---\n\n# Slide").isDeck).toBe(true);
    expect(detectSlidevDeck("---\ntransition: slide-left\n---\n\n# Slide").isDeck).toBe(true);
  });

  it("detects an explicit override", () => {
    expect(detectSlidevDeck("---\nformat: slidev\n---\n\n# X").isDeck).toBe(true);
    expect(detectSlidevDeck("---\nslidev: true\n---\n\n# X").isDeck).toBe(true);
  });

  it("detects multiple weak keys together", () => {
    expect(detectSlidevDeck("---\ntheme: seriph\nlayout: cover\n---\n\n# X").isDeck).toBe(true);
  });

  it("detects one weak key + slide separators", () => {
    const md = "---\ntheme: default\n---\n\n# One\n\n---\n\n# Two\n";
    expect(detectSlidevDeck(md).isDeck).toBe(true);
  });
});

describe("detectSlidevDeck — false-positive regression (ordinary notes)", () => {
  it("is NOT a deck with only title/tags/date frontmatter", () => {
    const md = "---\ntitle: My Note\ntags: [a, b]\ndate: 2026-01-01\n---\n\n# Heading\n\nbody";
    expect(detectSlidevDeck(md).isDeck).toBe(false);
  });

  it("is NOT a deck for a single weak key with no separators", () => {
    // A note that happens to carry `layout:` for some other tool.
    expect(detectSlidevDeck("---\nlayout: post\n---\n\nbody only").isDeck).toBe(false);
  });

  it("is NOT a deck for thematic-break --- in plain prose", () => {
    const md = "# Title\n\npara one\n\n---\n\npara two";
    expect(detectSlidevDeck(md).isDeck).toBe(false);
  });

  it("is NOT a deck with no frontmatter at all", () => {
    expect(detectSlidevDeck("# Just markdown\n\ntext").isDeck).toBe(false);
  });

  it("handles malformed headmatter without throwing", () => {
    expect(detectSlidevDeck("---\n: : bad yaml : :\n---\n\nx").isDeck).toBe(false);
  });
});

describe("extractHeadmatter", () => {
  it("parses the first YAML block", () => {
    expect(extractHeadmatter("---\ntheme: x\n---\n\nbody")).toEqual({ theme: "x" });
  });
  it("returns null without headmatter", () => {
    expect(extractHeadmatter("# no fm")).toBeNull();
  });
});
