/**
 * Tests for the pure image-reference parser.
 *
 * This parser decides which files orphan cleanup DELETES — a reference it
 * misses is a picture the user loses. Cases here are written from that angle.
 */

import { describe, it, expect } from "vitest";
import {
  assetKey,
  extractImageReferences,
  extractImageReferenceKeys,
  normalizeImageReference,
  referenceKey,
} from "./imageReferences";


// ---- extractImageReferences (pure) ----

describe("extractImageReferences", () => {
  it("extracts standard markdown image paths", () => {
    const content = "![alt](assets/images/test.png)";
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/test.png")).toBe(true);
  });

  it("extracts paths with ./ prefix and normalizes them", () => {
    const content = "![alt](./assets/images/test.png)";
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/test.png")).toBe(true);
  });

  it("extracts paths with title attribute", () => {
    const content = '![alt](./assets/images/test.png "Title")';
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/test.png")).toBe(true);
  });

  it("extracts angle bracket syntax for paths with spaces", () => {
    const content = "![alt](<./assets/images/my image.png>)";
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/my image.png")).toBe(true);
  });

  it("extracts URL-encoded paths and decodes them", () => {
    const content = "![alt](./assets/images/my%20image.png)";
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/my image.png")).toBe(true);
  });

  it("extracts multiple images from content", () => {
    const content = `
# Document

![first](./assets/images/first.png)

Some text here.

![second](./assets/images/second.jpg)

More text.

![third](./assets/images/third.gif)
`;
    const refs = extractImageReferences(content);
    expect(refs.size).toBe(3);
    expect(refs.has("assets/images/first.png")).toBe(true);
    expect(refs.has("assets/images/second.jpg")).toBe(true);
    expect(refs.has("assets/images/third.gif")).toBe(true);
  });

  it("extracts HTML img tags", () => {
    const content = '<img src="./assets/images/test.png" alt="test">';
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/test.png")).toBe(true);
  });

  it("extracts HTML img with single quotes", () => {
    const content = "<img src='./assets/images/test.png' alt='test'>";
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/test.png")).toBe(true);
  });

  it("handles mixed markdown and HTML images", () => {
    const content = `
![md](./assets/images/markdown.png)
<img src="./assets/images/html.png">
`;
    const refs = extractImageReferences(content);
    expect(refs.size).toBe(2);
    expect(refs.has("assets/images/markdown.png")).toBe(true);
    expect(refs.has("assets/images/html.png")).toBe(true);
  });

  it("handles empty alt text", () => {
    const content = "![](./assets/images/test.png)";
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/test.png")).toBe(true);
  });

  it("extracts the path even when alt text contains parentheses", () => {
    const content = "![a photo (2024)](./assets/images/test.png)";
    expect(extractImageReferences(content).has("assets/images/test.png")).toBe(true);
  });

  // A reference this parser cannot see is a file that gets DELETED: the
  // subject document stops protecting it, and the sibling scan — same parser —
  // misses it too. Nothing downstream compensates. Both forms below appear in
  // ordinary documents.
  it("extracts the path when alt text contains nested brackets", () => {
    const content = "![image with [brackets]](./assets/images/nested.png)";
    expect(extractImageReferences(content).has("assets/images/nested.png")).toBe(true);
  });

  it("extracts a destination containing balanced parentheses", () => {
    const content = "![shot](./assets/images/screenshot_(1).png)";
    expect(extractImageReferences(content).has("assets/images/screenshot_(1).png")).toBe(true);
  });

  it("returns empty set for content with no images", () => {
    const content = "# Just text\n\nNo images here.";
    const refs = extractImageReferences(content);
    expect(refs.size).toBe(0);
  });

  it("handles external URLs (should still extract)", () => {
    const content = "![external](https://example.com/image.png)";
    const refs = extractImageReferences(content);
    expect(refs.has("https://example.com/image.png")).toBe(true);
  });

  it("deduplicates repeated references", () => {
    const content = `
![first](./assets/images/same.png)
![second](./assets/images/same.png)
![third](./assets/images/same.png)
`;
    const refs = extractImageReferences(content);
    expect(refs.size).toBe(1);
    expect(refs.has("assets/images/same.png")).toBe(true);
  });

  // ---- Additional edge cases for coverage ----

  it("returns empty set for empty string", () => {
    expect(extractImageReferences("").size).toBe(0);
  });

  it("handles path without ./ prefix (no normalization needed)", () => {
    const content = "![alt](assets/photo.jpg)";
    const refs = extractImageReferences(content);
    expect(refs.has("assets/photo.jpg")).toBe(true);
  });

  it("handles CJK filenames in markdown images", () => {
    const content = "![alt](./assets/images/\u622a\u56fe.png)";
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/\u622a\u56fe.png")).toBe(true);
  });

  it("handles CJK filenames in HTML img tags", () => {
    const content = '<img src="./assets/images/\u622a\u56fe.png">';
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/\u622a\u56fe.png")).toBe(true);
  });

  it("handles URL-encoded CJK in img src", () => {
    const content = '<img src="./assets/images/%E6%88%AA%E5%9B%BE.png">';
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/\u622a\u56fe.png")).toBe(true);
  });

  it("handles malformed percent encoding gracefully", () => {
    const content = "![alt](./assets/images/%ZZ%invalid.png)";
    const refs = extractImageReferences(content);
    // decodeURIComponent fails, so raw string (with ./ stripped) is used
    expect(refs.has("assets/images/%ZZ%invalid.png")).toBe(true);
  });

  it("handles malformed percent encoding in HTML img tags", () => {
    const content = '<img src="./assets/images/%ZZ%bad.png">';
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/%ZZ%bad.png")).toBe(true);
  });

  it("handles img tag without ./ prefix", () => {
    const content = '<img src="assets/images/direct.png">';
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/direct.png")).toBe(true);
  });

  it("handles multiple img tags on same line", () => {
    const content = '<img src="a.png"><img src="b.png">';
    const refs = extractImageReferences(content);
    expect(refs.has("a.png")).toBe(true);
    expect(refs.has("b.png")).toBe(true);
  });

  it("handles img tag with extra attributes", () => {
    const content = '<img width="100" src="./assets/photo.png" height="50" alt="pic">';
    const refs = extractImageReferences(content);
    expect(refs.has("assets/photo.png")).toBe(true);
  });

  it("handles angle bracket path without ./ prefix", () => {
    const content = "![alt](<assets/my image.png>)";
    const refs = extractImageReferences(content);
    expect(refs.has("assets/my image.png")).toBe(true);
  });

  it("handles markdown link (not image) — should not extract", () => {
    const content = "[click here](https://example.com)";
    const refs = extractImageReferences(content);
    expect(refs.size).toBe(0);
  });

  it("handles content with only whitespace", () => {
    const content = "   \n\n   \t  ";
    const refs = extractImageReferences(content);
    expect(refs.size).toBe(0);
  });
});

// ---- normalization (the rules that decide a match) ----

describe("normalizeImageReference", () => {
  it.each([
    ["./assets/images/a.png", "assets/images/a.png"],
    [".//assets/images/a.png", "/assets/images/a.png"],
    ["assets/images/a.png?v=2", "assets/images/a.png"],
    ["assets/images/a.png#frag", "assets/images/a.png"],
    ["assets/images/a.png?v=2#frag", "assets/images/a.png"],
    ["assets\\images\\a.png", "assets/images/a.png"],
    ["assets/images/my%20pic.png", "assets/images/my pic.png"],
    ["assets/images/%E6%88%AA%E5%9B%BE.png", "assets/images/截图.png"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeImageReference(raw)).toBe(expected);
  });

  it("keeps a malformed percent-encoded path rather than dropping it", () => {
    expect(normalizeImageReference("assets/images/%ZZ.png")).toBe("assets/images/%ZZ.png");
  });

  it("strips repeated ./ prefixes", () => {
    expect(normalizeImageReference("././assets/images/a.png")).toBe("assets/images/a.png");
  });
});

describe("referenceKey", () => {
  it("folds case — macOS resolves Photo.png to photo.png on disk", () => {
    expect(referenceKey("assets/images/Photo.PNG")).toBe(referenceKey("assets/images/photo.png"));
  });

  it("normalizes and folds together", () => {
    expect(referenceKey("./assets/images/A.png?v=1")).toBe("assets/images/a.png");
  });
});

describe("extractImageReferenceKeys", () => {
  it("returns comparison keys for every reference", () => {
    const keys = extractImageReferenceKeys("![](./assets/images/Photo.PNG)");
    expect(keys.has("assets/images/photo.png")).toBe(true);
  });

  it("is empty for content with no images", () => {
    expect(extractImageReferenceKeys("plain text").size).toBe(0);
  });
});

// ---- reference-style images (the destructive gap) ----
//
// `![alt][label]` puts the path in a definition line, not the image. Missing
// those made every reference-style image in a document look unreferenced.

describe("link reference definitions", () => {
  it("extracts a full reference definition", () => {
    const content = "![alt][hero]\n\n[hero]: ./assets/images/hero.png";
    expect(extractImageReferences(content).has("assets/images/hero.png")).toBe(true);
  });

  it("extracts a definition with a title", () => {
    const content = '[hero]: ./assets/images/hero.png "The hero"';
    expect(extractImageReferences(content).has("assets/images/hero.png")).toBe(true);
  });

  it("extracts a definition wrapped in angle brackets", () => {
    const content = "[hero]: <./assets/images/my hero.png>";
    expect(extractImageReferences(content).has("assets/images/my hero.png")).toBe(true);
  });

  it("extracts a collapsed reference definition", () => {
    const content = "![hero][]\n\n[hero]: assets/images/hero.png";
    expect(extractImageReferences(content).has("assets/images/hero.png")).toBe(true);
  });

  it("extracts a shortcut reference definition", () => {
    const content = "![hero]\n\n[hero]: assets/images/hero.png";
    expect(extractImageReferences(content).has("assets/images/hero.png")).toBe(true);
  });

  it("allows up to three spaces of indent", () => {
    const content = "   [hero]: assets/images/hero.png";
    expect(extractImageReferences(content).has("assets/images/hero.png")).toBe(true);
  });

  it("ignores a four-space indented line (that is an indented code block)", () => {
    const content = "    [hero]: assets/images/hero.png";
    expect(extractImageReferences(content).has("assets/images/hero.png")).toBe(false);
  });

  it("also keeps plain link definitions — a link target in assets is worth protecting", () => {
    const content = "[doc]: ./assets/images/diagram.svg";
    expect(extractImageReferences(content).has("assets/images/diagram.svg")).toBe(true);
  });
});

// ---- nesting and escaping (a miss here deletes a live file) ----

describe("inline image scanning", () => {
  it.each([
    ["![a](./assets/images/plain.png)", "assets/images/plain.png"],
    ["![a [b] c](./assets/images/n1.png)", "assets/images/n1.png"],
    ["![a [b [c]] d](./assets/images/n2.png)", "assets/images/n2.png"],
    ["![a](./assets/images/p_(1).png)", "assets/images/p_(1).png"],
    ["![a](./assets/images/p_((2)).png)", "assets/images/p_((2)).png"],
    ['![a](./assets/images/t.png "title")', "assets/images/t.png"],
    ["![a](./assets/images/t.png 'title')", "assets/images/t.png"],
    ["![a](./assets/images/t.png (title))", "assets/images/t.png"],
    ["![a](<./assets/images/with space.png>)", "assets/images/with space.png"],
    ["![a](  ./assets/images/pad.png  )", "assets/images/pad.png"],
  ])("%s → %s", (content, expected) => {
    expect(extractImageReferences(content).has(expected)).toBe(true);
  });

  it("finds several images on one line", () => {
    const refs = extractImageReferences(
      "![a](./assets/images/a_(1).png) and ![b [x]](./assets/images/b.png)",
    );
    expect(refs.has("assets/images/a_(1).png")).toBe(true);
    expect(refs.has("assets/images/b.png")).toBe(true);
  });

  it("skips an escaped image marker", () => {
    expect(extractImageReferences("\\![a](./assets/images/x.png)").size).toBe(0);
  });

  it("ignores an unterminated alt", () => {
    expect(extractImageReferences("![a(./assets/images/x.png)").size).toBe(0);
  });

  it("ignores an unterminated destination", () => {
    expect(extractImageReferences("![a](./assets/images/x.png").size).toBe(0);
  });

  it("ignores an empty destination", () => {
    expect(extractImageReferences("![a]()").size).toBe(0);
  });

  it("leaves a reference-style image to its definition", () => {
    // `![a][ref]` carries no destination of its own.
    expect(extractImageReferences("![a][ref]").size).toBe(0);
  });
});

describe("HTML img tags", () => {
  it.each([
    ['<img src="./assets/images/a.png">', "assets/images/a.png"],
    ["<img src='./assets/images/b.png'>", "assets/images/b.png"],
    ["<img src=./assets/images/c.png>", "assets/images/c.png"],
    ['<img  src = "./assets/images/d.png" >', "assets/images/d.png"],
    ['<img alt="x" src="./assets/images/e.png" width="10">', "assets/images/e.png"],
    ['<IMG SRC="./assets/images/f.png">', "assets/images/f.png"],
  ])("%s → %s", (content, expected) => {
    expect(extractImageReferences(content).has(expected)).toBe(true);
  });

  // Lazy-loading markup points at a real file. Protecting it costs one stray
  // set entry; missing it costs the file.
  it("also collects a lazy-loading data-src", () => {
    const refs = extractImageReferences('<img data-src="./assets/images/lazy.png">');
    expect(refs.has("assets/images/lazy.png")).toBe(true);
  });

  it("does not treat an unrelated *src-suffixed attribute as a source", () => {
    expect(extractImageReferences('<img fallbacksrc="./assets/images/x.png">').size).toBe(0);
  });
});

// ---- escaping (each miss below is a deleted file) ----

describe("escape handling", () => {
  it("treats an ESCAPED backslash before the marker as a real image", () => {
    // `\\![a](x)` is a literal backslash followed by an image, not an escaped
    // marker. Odd runs escape, even runs do not.
    const refs = extractImageReferences("\\\\![a](./assets/images/real.png)");
    expect(refs.has("assets/images/real.png")).toBe(true);
  });

  it("still skips a genuinely escaped marker", () => {
    expect(extractImageReferences("\\![a](./assets/images/x.png)").size).toBe(0);
  });

  it("skips with three backslashes (odd run)", () => {
    expect(extractImageReferences("\\\\\\![a](./assets/images/x.png)").size).toBe(0);
  });

  it("unescapes markdown punctuation escapes in a destination", () => {
    // `image\(1\).png` is one filename — folding those backslashes into path
    // separators would invent two directories and orphan the real file.
    const refs = extractImageReferences("![a](./assets/images/image\\(1\\).png)");
    expect(refs.has("assets/images/image(1).png")).toBe(true);
  });

  it("still folds Windows path separators", () => {
    expect(normalizeImageReference("assets\\images\\x.png")).toBe("assets/images/x.png");
  });

  it("handles an escaped bracket inside a reference definition label", () => {
    const content = "[a\\]b]: ./assets/images/hero.png";
    expect(extractImageReferences(content).has("assets/images/hero.png")).toBe(true);
  });
});

describe("HTML attribute scanning", () => {
  it("takes the real src even when another attribute contains 'src='", () => {
    const content = '<img alt="see src=decoy.png" src="./assets/images/real.png">';
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/real.png")).toBe(true);
  });

  it("collects BOTH src and data-src from one tag", () => {
    const content =
      '<img src="./assets/images/placeholder.png" data-src="./assets/images/full.png">';
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/placeholder.png")).toBe(true);
    expect(refs.has("assets/images/full.png")).toBe(true);
  });

  it("ignores a namespaced x:src attribute", () => {
    expect(extractImageReferences('<img x:src="./assets/images/x.png">').size).toBe(0);
  });

  it("collects from several tags on one line", () => {
    const refs = extractImageReferences(
      '<img src="./assets/images/a.png"><img src="./assets/images/b.png">',
    );
    expect(refs.has("assets/images/a.png")).toBe(true);
    expect(refs.has("assets/images/b.png")).toBe(true);
  });
});

// Each case below is a file the document DISPLAYS that the parser stopped
// seeing — and an unseen reference is a deletion candidate.

describe("a malformed image does not hide the ones after it", () => {
  it("keeps scanning past an unterminated destination", () => {
    // The unterminated `(` used to scan to any later `)` — a smiley suffices —
    // and every image inside that span was skipped.
    const content = [
      "![diagram](assets/images/diagram.png",
      "",
      "![screenshot](assets/images/screenshot.png)",
      "",
      "Smiley :)",
    ].join("\n");
    const keys = extractImageReferenceKeys(content);
    expect(keys.has("assets/images/screenshot.png")).toBe(true);
  });

  it("keeps scanning past an unterminated destination closed by prose", () => {
    const content = [
      "![a](assets/images/a.png",
      "",
      "![b](assets/images/b.png)",
      "",
      "see note) here",
    ].join("\n");
    expect(extractImageReferenceKeys(content).has("assets/images/b.png")).toBe(true);
  });

  it("keeps scanning past an unterminated alt", () => {
    const content = "![unclosed\n\n![real](assets/images/real.png)";
    expect(extractImageReferenceKeys(content).has("assets/images/real.png")).toBe(true);
  });

  it("does not let an image span a blank line", () => {
    // A destination cannot cross a blank line, so this is literal text.
    const content = "![a](assets/images/\n\na.png)";
    expect(extractImageReferences(content).has("assets/images/a.png")).toBe(false);
  });
});

describe("img tags with a > inside an attribute value", () => {
  it.each([
    ['<img alt="a > b" src="./assets/images/x.png">', "assets/images/x.png"],
    ["<img alt='x > y' src='./assets/images/y.png'>", "assets/images/y.png"],
    ['<img title="1 > 0" data-src="./assets/images/z.png">', "assets/images/z.png"],
  ])("finds the src in %s", (content, expected) => {
    // `[^>]*` ended the tag at the `>` inside the attribute, before the src.
    expect(extractImageReferences(content).has(expected)).toBe(true);
  });
});

describe("filenames that legitimately contain ? or #", () => {
  it.each([
    "assets/images/a#b.png",
    "assets/images/q?x.png",
    "assets/images/both#a?b.png",
  ])("keeps %s matchable as a whole filename", (path) => {
    // referenceKey truncates at the first ?/#, which is right for a URL and
    // wrong for a filename. Both spellings are kept so either can match.
    const keys = extractImageReferenceKeys(`![](${path})`);
    expect(keys.has(assetKey(path))).toBe(true);
  });

  it("still matches a cache-busting query against the bare file", () => {
    const keys = extractImageReferenceKeys("![](assets/images/photo.png?v=2)");
    expect(keys.has("assets/images/photo.png")).toBe(true);
  });

  it("matches a percent-encoded # against the real filename", () => {
    const keys = extractImageReferenceKeys("![](assets/images/a%23b.png)");
    expect(keys.has(assetKey("assets/images/a#b.png"))).toBe(true);
  });
});

describe("assetKey", () => {
  it("does not truncate at ? or #", () => {
    expect(assetKey("assets/images/a#b.png")).toBe("assets/images/a#b.png");
    expect(assetKey("assets/images/q?x.png")).toBe("assets/images/q?x.png");
  });

  it("folds case and strips ./ like referenceKey", () => {
    expect(assetKey("./assets/images/A#B.PNG")).toBe("assets/images/a#b.png");
  });
});

// Every case below is a file the document DISPLAYS whose reference the parser
// could not see — i.e. a picture orphan cleanup would have deleted. Found by an
// independent Codex audit of this branch and reproduced before fixing.
describe("references a renderer resolves but the scanner missed", () => {
  it("alt text containing a code span with a bracket", () => {
    expect(extractImageReferenceKeys("![a `]` b](assets/images/photo.png)").has("assets/images/photo.png")).toBe(true);
  });

  it("a paren inside an angle-bracket destination", () => {
    expect(extractImageReferenceKeys("![x](<assets/images/foo(1.png>)").has("assets/images/foo(1.png")).toBe(true);
  });

  it("a paren inside a quoted title", () => {
    expect(extractImageReferenceKeys('![x](assets/images/photo.png "title (")').has("assets/images/photo.png")).toBe(true);
  });

  it("a single-quoted title with a paren", () => {
    expect(extractImageReferenceKeys("![x](assets/images/p.png 'a (b')").has("assets/images/p.png")).toBe(true);
  });

  it.each([
    ["CRLF", "![b](assets/images/b.png\r\n\r\n![real](assets/images/real.png)\r\nprose)"],
    ["whitespace-only blank line", "![b](assets/images/b.png\n   \n![real](assets/images/real.png)\nx)"],
    ["tab-only blank line", "![b](assets/images/b.png\n\t\n![real](assets/images/real.png)\nx)"],
  ])("a malformed image before a %s blank line does not swallow the next", (_l, content) => {
    expect(extractImageReferenceKeys(content).has("assets/images/real.png")).toBe(true);
  });

  it("a reference definition whose destination is on the next line", () => {
    expect(extractImageReferenceKeys("![x][id]\n\n[id]:\n  assets/images/photo.png").has("assets/images/photo.png")).toBe(true);
  });

  it.each([
    ["&amp;", "assets/images/a&amp;b.png", "assets/images/a&b.png"],
    ["&#38;", "assets/images/a&#38;b.png", "assets/images/a&b.png"],
    ["&#x26;", "assets/images/a&#x26;b.png", "assets/images/a&b.png"],
  ])("a %s character reference resolves to the real filename", (_l, ref, expected) => {
    expect(extractImageReferenceKeys(`![](${ref})`).has(expected)).toBe(true);
  });

  it("leaves an unknown entity alone rather than mangling it", () => {
    expect(extractImageReferenceKeys("![](assets/images/a&zzz;b.png)").has("assets/images/a&zzz;b.png")).toBe(true);
  });

  it.each([
    ['<img srcset="assets/images/retina.png 2x">', "assets/images/retina.png"],
    ['<img srcset="assets/images/a.png 1x, assets/images/b.png 2x">', "assets/images/b.png"],
    ['<source srcset="assets/images/wide.png" media="(min-width: 60em)">', "assets/images/wide.png"],
  ])("a srcset candidate in %s is protected", (content, expected) => {
    expect(extractImageReferenceKeys(content).has(expected)).toBe(true);
  });

  it("collects every candidate in a srcset list", () => {
    const keys = extractImageReferenceKeys('<img srcset="assets/images/a.png 1x, assets/images/b.png 2x, assets/images/c.png 3x">');
    for (const f of ["a", "b", "c"]) expect(keys.has(`assets/images/${f}.png`)).toBe(true);
  });
});

// The last two "accepted" parser gaps, now closed: escaped `>` inside angle
// destinations. Both previously fell apart into wrong or missing references.
describe("escaped > in angle-bracket destinations", () => {
  it("keeps an inline destination containing an escaped >", () => {
    const refs = extractImageReferences("![a](<assets/images/a\\>b.png>)");
    expect(refs.has("assets/images/a>b.png")).toBe(true);
  });

  it("keeps a definition destination containing an escaped >", () => {
    const refs = extractImageReferences("[id]: <assets/images/a\\>b.png>\n\n![x][id]");
    expect(refs.has("assets/images/a>b.png")).toBe(true);
  });

  it("still ends an angle span at a real >", () => {
    const refs = extractImageReferences("![a](<assets/images/plain.png>)");
    expect(refs.has("assets/images/plain.png")).toBe(true);
  });
});
