// S-02 — the TypeScript mirror's role inference, split out of aria.ts so the
// name module can ask "is this a landmark?" without an import cycle. Held to
// the injected core's answers by `ariaParity.test.ts`.
import { describe, it, expect } from "vitest";
import { computeRole, isLandmarkRole, HEADING_TAGS } from "./ariaRole";

function el(html: string): Element {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body.firstElementChild!;
}

describe("computeRole", () => {
  it.each([
    [`<summary>x</summary>`, "button"],
    [`<button>x</button>`, "button"],
    [`<a href="/x">x</a>`, "link"],
    [`<a>x</a>`, null],
    [`<input type="file">`, "textbox"],
    [`<input type="hidden">`, null],
    [`<div role=" Region ">x</div>`, "region"],
    [`<div role="none">x</div>`, null],
  ])("%s → %s", (html, role) => {
    expect(computeRole(el(html))).toBe(role);
  });
});

describe("isLandmarkRole", () => {
  it.each(["main", "navigation", "banner", "contentinfo", "complementary", "region", "form", "search"])(
    "%s is a landmark",
    (role) => {
      expect(isLandmarkRole(role)).toBe(true);
    },
  );
  it.each(["button", "link", "heading", "textbox", null])("%s is not", (role) => {
    expect(isLandmarkRole(role)).toBe(false);
  });
});

describe("HEADING_TAGS", () => {
  it("maps h1..h6 to their level", () => {
    expect(HEADING_TAGS).toEqual({ h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 });
  });
});
