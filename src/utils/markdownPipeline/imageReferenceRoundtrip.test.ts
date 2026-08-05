/**
 * Reference-style IMAGES must survive a save, exactly as reference links do.
 *
 * `![alt][id]` is resolved to an inline image so the editor has a real `src`
 * to render. Before this, that resolution was one-way: the image serialized
 * back inline, its `[id]: url` definition became an orphan, and VMark's own
 * lint then flagged W03 "unused link definition" on VMark's own output.
 *
 * The second half is the trap: a node that keeps its reference identity after
 * the user EDITS the source would re-emit `![alt][id]`, whose destination
 * still comes from the untouched definition — silently discarding the new
 * URL. So editing the source must detach.
 *
 * @coordinates-with plugins/resolveReferences.ts — records the identity
 * @coordinates-with imageReferenceEmit.ts — puts it back
 * @coordinates-with @/utils/referenceIdentity — the detach rule
 * @module utils/markdownPipeline/imageReferenceRoundtrip.test
 */
import { describe, it, expect } from "vitest";
import { parseMarkdown, serializeMarkdown } from "./adapter";
import { getProductionSchema } from "@/test/productionSchema";

const schema = getProductionSchema();
const roundTrip = (md: string) =>
  serializeMarkdown(schema, parseMarkdown(schema, md)).trim();

describe("reference images survive the round trip", () => {
  it("keeps a full reference", () => {
    const src = "![Logo][logo]\n\n[logo]: /logo.png";
    const out = roundTrip(src);
    expect(out).toContain("![Logo][logo]");
    expect(out).toContain("[logo]: /logo.png");
    expect(roundTrip(out)).toBe(out);
  });

  it("keeps a collapsed reference", () => {
    const out = roundTrip("![logo][]\n\n[logo]: /logo.png");
    // The IMAGE must still be a reference — asserting "[logo] appears" is
    // satisfied by the preserved definition line alone.
    expect(out).toMatch(/!\[logo\]\[/);
    expect(out).not.toContain("![logo](/logo.png)");
    expect(roundTrip(out)).toBe(out);
  });

  it("keeps a shortcut reference", () => {
    const out = roundTrip("![logo]\n\n[logo]: /logo.png");
    expect(out).toMatch(/!\[logo\]/);
    expect(out).not.toContain("(/logo.png)");
    expect(roundTrip(out)).toBe(out);
  });

  it("does not orphan the definition (the W03 lint case)", () => {
    const out = roundTrip("![Logo][logo]\n\n[logo]: /logo.png");
    // The definition is still referenced by something in the output.
    expect(out).toMatch(/\[logo\]/);
    expect(out).not.toBe("![Logo](/logo.png)\n\n[logo]: /logo.png");
  });

  it("keeps a reference on an image promoted to a block video", () => {
    const out = roundTrip("![clip][v]\n\n[v]: /movie.mp4");
    expect(out).toMatch(/!\[clip\]\[v\]/);
    expect(out).not.toContain("(/movie.mp4)");
    expect(roundTrip(out)).toBe(out);
  });

  it("keeps a reference on an image promoted to block audio", () => {
    const out = roundTrip("![song][a]\n\n[a]: /track.mp3");
    expect(out).toMatch(/!\[song\]\[a\]/);
    expect(out).not.toContain("(/track.mp3)");
    expect(roundTrip(out)).toBe(out);
  });

  it("leaves an ordinary inline image untouched", () => {
    expect(roundTrip("![alt](/pic.png)")).toBe("![alt](/pic.png)");
  });

  it("handles a CJK label", () => {
    const out = roundTrip("![图][标识]\n\n[标识]: /logo.png");
    expect(out).toContain("标识");
    expect(roundTrip(out)).toBe(out);
  });
});

describe("first definition wins, per CommonMark", () => {
  it("resolves the EDITING href against the first definition", () => {
    // Output order proves nothing — check the href the editor actually got.
    const doc = parseMarkdown(schema, "[t][d]\n\n[d]: /first\n\n[d]: /second");
    const hrefs: string[] = [];
    doc.descendants((node) => {
      for (const m of node.marks) {
        if (m.type.name === "link") hrefs.push(m.attrs.href as string);
      }
    });
    expect(hrefs).toEqual(["/first"]);
  });
});
