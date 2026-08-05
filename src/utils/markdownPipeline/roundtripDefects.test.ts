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

/** True when the markdown still contains a real link node when reparsed. */
function isStillALink(md: string): boolean {
  let found = false;
  parseMarkdown(schema, md).descendants((node) => {
    if (node.marks.some((m) => m.type.name === "link")) found = true;
  });
  return found;
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

  describe("D3 — highlight with a nested mark must survive", () => {
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

  describe("D4 — escaped custom markers must stay literal", () => {
    it("keeps escaped superscript markers literal (does not become a superscript)", () => {
      const out = roundTrip("x\\^2\\^");
      // Re-parsing the output must yield the SAME document — no real superscript.
      expect(roundTrip(out)).toBe(out);
      expect(out).not.toBe("x^2^");
    });

    it("keeps escaped subscript markers literal", () => {
      const out = roundTrip("x\\~2\\~");
      expect(roundTrip(out)).toBe(out);
      expect(out).not.toBe("x~2~");
    });

    it("still round-trips a real superscript", () => {
      expect(roundTrip("x^2^")).toBe("x^2^");
    });
  });

  describe("D5 — a document-leading thematic break must not become frontmatter", () => {
    // The serializer normalizes thematic breaks to `---`; on line 1 the
    // reparse reads that as a frontmatter fence and swallows structure
    // (CommonMark spec examples 43, 47, 77).
    it("does not emit `---` as the first line of a document", () => {
      const out = roundTrip("***\n\ntext");
      expect(out).not.toMatch(/^---/);
      expect(roundTrip(out)).toBe(out);
    });

    it("keeps three consecutive thematic breaks as three", () => {
      const out = roundTrip("***\n---\n___\n");
      expect(roundTrip(out)).toBe(out);
      const reparsed = roundTrip(out);
      expect((reparsed.match(/^(\*\*\*|---|___)$/gm) ?? []).length).toBe(3);
    });

    it("still serializes real frontmatter with its `---` fences", () => {
      expect(roundTrip("---\ntitle: T\n---\n\nBody.")).toBe(
        "---\ntitle: T\n---\n\nBody.",
      );
    });

    it("keeps `---` for a thematic break that is not the first block", () => {
      expect(roundTrip("text\n\n---")).toBe("text\n\n---");
    });
  });

  describe("D6 — bracket escapes in links must not grow across round trips", () => {
    // CommonMark spec examples 194, 512, 549, 550: serialized escapes inside
    // link text / reference labels did not reparse as the same link, so the
    // next save degraded the construct to literal text.
    it("escapes `]` in inline link text so the link survives", () => {
      const out = roundTrip("[link [foo [bar]]](/uri)");
      expect(roundTrip(out)).toBe(out);
      expect(out).toContain("](/uri)");
    });

    it("keeps a full reference whose label contains an escaped bracket", () => {
      const out = roundTrip("[foo][ref\\[]\n\n[ref\\[]: /uri");
      expect(roundTrip(out)).toBe(out);
      expect(out).toContain("[foo][");
      expect(out).toContain("]: /uri");
    });

    it("keeps a shortcut reference whose label ends in a backslash", () => {
      const out = roundTrip("[bar\\\\]: /uri\n\n[bar\\\\]");
      expect(roundTrip(out)).toBe(out);
      expect(out).toContain("]: /uri");
      expect(out).not.toMatch(/\\\[bar/);
    });

    it("keeps a shortcut reference with `*` and an escaped bracket in the label", () => {
      const out = roundTrip(
        "[Foo*bar\\]]:my_(url) 'title (with parens)'\n\n[Foo*bar\\]]",
      );
      expect(roundTrip(out)).toBe(out);
      expect(out).toContain("]: my_");
    });
  });

  describe("D7 — URL destinations must survive the round trip exactly", () => {
    // CommonMark bounds the autolink scheme (2-32 chars, digits allowed after
    // the first) and the raw-destination paren nesting (32 deep). Emitting a
    // form outside those bounds produces markdown that reparses as TEXT,
    // destroying the link.
    it("keeps a link whose scheme contains digits as an autolink", () => {
      // `s3` was not recognized as a scheme (digits excluded), so the
      // authored autolink form was rewritten to a resource link.
      const out = roundTrip("<s3://bucket/key>");
      expect(roundTrip(out)).toBe(out);
      expect(out).toBe("<s3://bucket/key>");
    });

    it("does not emit an autolink for an over-long scheme", () => {
      const scheme = "a".repeat(33);
      const out = roundTrip(`[${scheme}:x](${scheme}:x)`);
      expect(roundTrip(out)).toBe(out);
      // "Stable" is not enough — stably-corrupted text is stable. The output
      // must still PARSE as a link.
      expect(isStillALink(out)).toBe(true);
    });

    it("keeps a destination containing an escaped backslash", () => {
      const out = roundTrip("[t](foo%5Cbar)");
      expect(roundTrip(out)).toBe(out);
      expect(out).toContain("foo%5Cbar");
    });

    it("keeps a destination whose literal text contains an entity spelling", () => {
      // The URL here IS `?a=1&amp;b=2`. Emitting it verbatim let the reparse
      // decode it to `?a=1&b=2` — a different URL, changed on every save.
      const src = "[t](https://e.test/?a=1&amp;amp;b=2)";
      const out = roundTrip(src);
      expect(roundTrip(out)).toBe(out);
      expect(out).toBe(src);
    });

    it("keeps a destination with deeply nested balanced parens", () => {
      // 40 pairs are balanced but exceed CommonMark's 32-deep limit, so the
      // raw form reparses as TEXT — the link is destroyed.
      const deep = `https://e.test/${"(".repeat(40)}${")".repeat(40)}`;
      const out = roundTrip(`[t](<${deep}>)`);
      expect(roundTrip(out)).toBe(out);
      expect(isStillALink(out)).toBe(true);
    });
  });
});
