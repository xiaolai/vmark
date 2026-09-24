// @vitest-environment node
/**
 * Marks around an inline image survive a markdown round trip.
 *
 * The parser built image nodes WITHOUT the marks in force around them and the
 * serializer wrote images unmarked, so opening and saving a document silently
 * rewrote `[![img](pic.png)](A.md)` as `![img](pic.png)` — the link was gone
 * from the author's file. Found while fixing #1448 (hyperlink bugs).
 */

import { describe, expect, it } from "vitest";
import { parseMarkdown, serializeMarkdown } from "./adapter";
import { getProductionSchema } from "@/test/productionSchema";

const schema = getProductionSchema();
const roundTrip = (md: string) => serializeMarkdown(schema, parseMarkdown(schema, md));

describe("marks around an inline image", () => {
  it.each([
    "[![img](pic.png)](A.md)\n",
    "图片链接: [![img](pic.png)](A.md) 后缀\n",
    "see [![a](p.png) caption](A.md) end\n",
    '[![img](p.png)](https://example.com "Title")\n',
    "**![img](p.png)**\n",
    "*x ![img](p.png) y*\n",
  ])("round-trips %j byte-identically", (md) => {
    expect(roundTrip(md)).toBe(md);
  });

  it("puts the link mark on the image node", () => {
    const doc = parseMarkdown(schema, "x [![img](pic.png)](A.md)\n");
    let href: unknown = null;
    doc.descendants((node) => {
      if (node.type.name === "image") {
        href = node.marks.find((m) => m.type.name === "link")?.attrs.href ?? null;
      }
    });
    expect(href).toBe("A.md");
  });

  it.each([
    "![img](pic.png)\n",
    "x ![img](pic.png) [link](A.md)\n",
    "[link](A.md)![img](pic.png)\n",
  ])("leaves an unmarked image unmarked: %j", (md) => {
    expect(roundTrip(md)).toBe(md);
  });
});
