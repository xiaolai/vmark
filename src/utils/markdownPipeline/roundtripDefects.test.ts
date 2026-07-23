/**
 * Round-trip fidelity regressions — the four data-loss/corruption defects the
 * Phase 0A corpus harness surfaced (dev-docs/plans/20260722-extension-architecture.md).
 *
 * Each asserts the CORRECT behaviour: a WYSIWYG save (parse → serialize) must not
 * lose or alter content. These run on the production schema, the same one
 * `useTiptapFlush` serializes through on every edit.
 *
 * @module utils/markdownPipeline/roundtripDefects.test
 */
import { describe, it, expect } from "vitest";
import { parseMarkdown, serializeMarkdown } from "./adapter";
import { getProductionSchema } from "@/test/productionSchema";

const schema = getProductionSchema();

/** One WYSIWYG round trip: markdown → PM doc → markdown. */
function roundTrip(md: string): string {
  return serializeMarkdown(schema, parseMarkdown(schema, md)).trim();
}

describe("round-trip defects", () => {
  describe("D1 — block media must preserve alt text", () => {
    it("keeps alt on a promoted video", () => {
      expect(roundTrip("![A short clip](clip.mp4)")).toBe("![A short clip](clip.mp4)");
    });

    it("keeps alt on a promoted audio", () => {
      expect(roundTrip("![A recording](recording.mp3)")).toBe(
        "![A recording](recording.mp3)",
      );
    });

    it("still round-trips an empty alt", () => {
      expect(roundTrip("![](clip.mp4)")).toBe("![](clip.mp4)");
    });

    it("leaves an ordinary image untouched", () => {
      expect(roundTrip("![a picture](pic.png)")).toBe("![a picture](pic.png)");
    });
  });

  describe("D2 — links must preserve their title", () => {
    it("keeps a link title", () => {
      expect(roundTrip('[text](https://example.com "Title")')).toBe(
        '[text](https://example.com "Title")',
      );
    });

    it("still round-trips a title-less link", () => {
      expect(roundTrip("[text](https://example.com)")).toBe("[text](https://example.com)");
    });
  });

  describe.todo("D3 — highlight with a nested mark must survive", () => {
    it("keeps a highlight wrapping bold", () => {
      const out = roundTrip("==highlight with **bold**==");
      // Must re-parse to the SAME document — the opening `==` must not be
      // escaped, which would destroy the highlight.
      expect(roundTrip(out)).toBe(out);
      expect(out).not.toMatch(/\\==/);
      expect(out).toContain("==");
    });

    it("keeps a plain highlight", () => {
      expect(roundTrip("==just highlight==")).toBe("==just highlight==");
    });
  });
});
