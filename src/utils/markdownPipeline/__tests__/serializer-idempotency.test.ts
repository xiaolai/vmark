/**
 * Serializer idempotency and autolink round-trip tests (#1102).
 *
 * Bug 1: nested strong (`**a **b** c**`) used to stack a duplicate `bold`
 * mark in the PM doc, which serialized as adjacent/nested strong siblings —
 * asterisk runs grew by 4 per side on every save and `&#x20;` entities were
 * injected. The serializer must reach a fixed point: feeding its own output
 * back in must not change it again.
 *
 * Bug 2: autolinks (`<https://…>`) and bare GFM URL literals were rewritten
 * to `[https\://…](https://…)` resource links. Links whose only child is a
 * text node equal to the URL must serialize back as autolinks.
 */
import { describe, it, expect } from "vitest";
import type { Root } from "mdast";
import { parseMarkdown, serializeMarkdown } from "../adapter";
import { serializeMdastToMarkdown } from "../serializer";
import { testSchema } from "../testSchema";

function roundTrip(md: string): string {
  return serializeMarkdown(testSchema, parseMarkdown(testSchema, md));
}

describe("emphasis idempotency (#1102 bug 1)", () => {
  it("collapses the reported nested-strong input to a stable form", () => {
    const once = roundTrip("**TLS 隐含于协议，无 **tls** 参数**");
    expect(once.trim()).toBe("**TLS 隐含于协议，无 tls 参数**");
    expect(roundTrip(once)).toBe(once);
  });

  it.each([
    ["**a **b** c**"],
    ["**foo **bar****"],
    ["*a *b* c*"],
  ])("reaches a fixed point after one round-trip: %s", (input) => {
    const once = roundTrip(input);
    expect(roundTrip(once)).toBe(once);
    expect(once).not.toContain("&#x20;");
  });

  it("does not stack duplicate bold marks on the PM doc", () => {
    const doc = parseMarkdown(testSchema, "**a **b** c**");
    const para = doc.child(0);
    para.forEach((child) => {
      const boldMarks = child.marks.filter((m) => m.type.name === "bold");
      expect(boldMarks.length).toBeLessThanOrEqual(1);
    });
  });

  it("still nests distinct marks (italic inside bold)", () => {
    const once = roundTrip("**a *b* c**");
    expect(once.trim()).toBe("**a *b* c**");
    expect(roundTrip(once)).toBe(once);
  });
});

describe("autolink preservation (#1102 bug 2)", () => {
  it("round-trips a URI autolink as an autolink", () => {
    const once = roundTrip("Autolink: <https://example.com/path>");
    expect(once.trim()).toBe("Autolink: <https://example.com/path>");
    expect(once).not.toContain("\\:");
  });

  it("serializes a bare GFM URL literal as an autolink", () => {
    const once = roundTrip("visit https://ruleset.skk.moe today");
    expect(once.trim()).toBe("visit <https://ruleset.skk.moe> today");
    expect(roundTrip(once)).toBe(once);
  });

  it("round-trips an email autolink", () => {
    expect(roundTrip("Mail me: <user@example.com>").trim()).toBe(
      "Mail me: <user@example.com>",
    );
  });

  it("keeps resource form when the link text differs from the URL", () => {
    expect(roundTrip("[Example](https://example.com/)").trim()).toBe(
      "[Example](https://example.com/)",
    );
  });

  it("keeps resource form when the link has a title", () => {
    // Link titles do not survive the PM round-trip (the link mark stores only
    // href — pre-existing, unrelated), so assert at the mdast level that a
    // titled link never collapses to an autolink.
    const root: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              url: "https://example.com/",
              title: "T",
              children: [{ type: "text", value: "https://example.com/" }],
            },
          ],
        },
      ],
    };
    expect(serializeMdastToMarkdown(root).trim()).toBe(
      '[https://example.com/](https://example.com/ "T")',
    );
  });
});
