/**
 * Integration tests for `sanitizeSvg`'s external-resource policy.
 *
 * The unit-level rules live in `svgResourcePolicy.test.ts`; these run the
 * real DOMPurify pipeline, which is where element-awareness and the
 * foreignObject HTML profile actually interact.
 */
import { describe, it, expect } from "vitest";
import { sanitizeSvg } from "./svgSanitize";

describe("sanitizeSvg — external resource references must not phone home", () => {
  // `use`/`image` are allowed for Mermaid, which only ever references
  // SAME-DOCUMENT fragments. An external target is a load-on-open beacon
  // (reader IP + open time) from an untrusted diagram.
  it("strips an external https href from use", () => {
    expect(sanitizeSvg('<svg><use href="https://evil.test/x.svg#y"/></svg>')).not.toContain(
      "evil.test",
    );
  });

  it("strips an external xlink:href from use", () => {
    expect(
      sanitizeSvg('<svg><use xlink:href="https://evil.test/x.svg#y"/></svg>'),
    ).not.toContain("evil.test");
  });

  it("strips an external href from image", () => {
    expect(sanitizeSvg('<svg><image href="https://evil.test/p.png"/></svg>')).not.toContain(
      "evil.test",
    );
  });

  it("strips a protocol-relative href", () => {
    expect(sanitizeSvg('<svg><image href="//evil.test/p.png"/></svg>')).not.toContain(
      "evil.test",
    );
  });

  it("strips an external src on HTML inside foreignObject", () => {
    // HTML inside <foreignObject> reaches this sanitizer too — the same
    // beacon by another spelling. Missed by the first version of the policy,
    // which only inspected href/xlink:href.
    expect(
      sanitizeSvg(
        '<svg><foreignObject><img src="https://evil.test/p.png"></foreignObject></svg>',
      ),
    ).not.toContain("evil.test");
  });

  it("strips an external poster on media inside foreignObject", () => {
    expect(
      sanitizeSvg(
        '<svg><foreignObject><video poster="https://evil.test/p.png"></video></foreignObject></svg>',
      ),
    ).not.toContain("evil.test");
  });

  it("strips an external url() from a paint attribute", () => {
    expect(sanitizeSvg('<svg><rect fill="url(https://evil.test/p.svg)"/></svg>')).not.toContain(
      "evil.test",
    );
  });

  it("strips an external url() from a style value", () => {
    expect(
      sanitizeSvg('<svg><rect style="fill:url(https://evil.test/p.svg)"/></svg>'),
    ).not.toContain("evil.test");
  });

  it("keeps a same-document fragment reference (Mermaid markers)", () => {
    expect(sanitizeSvg('<svg><use href="#arrowhead"/></svg>')).toContain('href="#arrowhead"');
  });

  it("keeps a same-document url() paint server (gradients)", () => {
    expect(sanitizeSvg('<svg><rect fill="url(#gradient)"/></svg>')).toContain("url(#gradient)");
  });

  it("keeps an inline data:image reference", () => {
    expect(
      sanitizeSvg('<svg><image href="data:image/png;base64,iVBORw0KGgo="/></svg>'),
    ).toContain("data:image/png");
  });

  it("keeps an ordinary link — navigation is not a fetch (Mermaid click directives)", () => {
    // Stripping these was a regression: a `click` directive renders
    // <a xlink:href="https://…">, which the reader must activate. DOMPurify's
    // URI policy still blocks javascript: there (asserted below).
    const result = sanitizeSvg(
      '<svg><a xlink:href="https://example.com"><text>label</text></a></svg>',
    );
    expect(result).toContain("example.com");
  });

  it("still blocks a javascript: link", () => {
    expect(
      sanitizeSvg('<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>'),
    ).not.toContain("javascript:");
  });
});

describe("sanitizeSvg — stylesheet content", () => {
  it("strips a remote @import from a <style> element", () => {
    // The attribute hook never sees this: the payload is element TEXT.
    expect(
      sanitizeSvg('<svg><style>@import url("https://evil.test/x.css");</style><rect/></svg>'),
    ).not.toContain("evil.test");
  });

  it("strips an external url() from a stylesheet rule", () => {
    expect(
      sanitizeSvg("<svg><style>rect{fill:url(https://evil.test/p.svg)}</style></svg>"),
    ).not.toContain("evil.test");
  });

  it("keeps ordinary Mermaid theming", () => {
    const out = sanitizeSvg(
      "<svg><style>.node rect{fill:#eee;stroke:#333}</style><rect/></svg>",
    );
    expect(out).toContain("fill:#eee");
  });
});

describe("sanitizeSvg — style attribute safety", () => {
  it("strips position:fixed from an SVG style attribute", () => {
    // A full-viewport overlay drawn by an untrusted diagram.
    expect(sanitizeSvg('<svg><rect style="position:fixed;top:0"/></svg>')).not.toContain(
      "fixed",
    );
  });

  it("strips it when written with a CSS comment or escape", () => {
    expect(sanitizeSvg('<svg><rect style="position:fixed/**/"/></svg>')).not.toContain(
      "fixed",
    );
    expect(sanitizeSvg('<svg><rect style="position:f\\ixed"/></svg>')).not.toContain(
      "ixed",
    );
  });

  it("keeps ordinary inline styling Mermaid relies on", () => {
    const out = sanitizeSvg('<svg><rect style="fill:#eee;stroke:#333"/></svg>');
    expect(out).toContain("fill:#eee");
  });
});
