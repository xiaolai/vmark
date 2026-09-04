// S-02 — the TypeScript mirror's role inference, split out of aria.ts so the
// name module can ask "is this a landmark?" without an import cycle. Held to
// the injected core's answers by `ariaParity.test.ts`.
import { describe, it, expect } from "vitest";
import { computeRole, isLandmarkRole, HEADING_TAGS, GLOBAL_ARIA } from "./ariaRole";
import ROLES_SRC from "./agentCoreRoles.src.js?raw";

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

describe("contenteditable is the editing HOST only (#110)", () => {
  it.each([
    [`<div contenteditable="">x</div>`, "textbox"],
    [`<div contenteditable="true">x</div>`, "textbox"],
    [`<div contenteditable="plaintext-only">x</div>`, "textbox"],
    [`<div contenteditable="false">x</div>`, null],
  ])("%s → %s", (html, role) => {
    expect(computeRole(el(html))).toBe(role);
  });
  it("a descendant of an editable host is not its own textbox", () => {
    const host = el(`<div contenteditable="true"><span>child</span></div>`);
    expect(computeRole(host)).toBe("textbox");
    expect(computeRole(host.firstElementChild!)).toBe(null);
  });
});

describe("explicit role token lists (#108)", () => {
  it("skips unknown leading tokens and takes the first recognized one", () => {
    expect(computeRole(el(`<div role="bogus button">x</div>`))).toBe("button");
    expect(computeRole(el(`<div role="unsupported nothing link">x</div>`))).toBe("link");
    expect(computeRole(el(`<div role="bogus">x</div>`))).toBe(null);
  });
});

describe("presentational conflict resolution (#107)", () => {
  it("a global ARIA property keeps the implicit role, like focusability does", () => {
    expect(computeRole(el(`<h2 role="none" aria-label="Section">x</h2>`))).toBe("heading");
    expect(computeRole(el(`<h2 role="none">x</h2>`))).toBe(null);
  });
  it.each(GLOBAL_ARIA)("%s is a global property: role=presentation yields to the implicit role", (attr) => {
    expect(computeRole(el(`<h2 role="presentation" ${attr}="x">x</h2>`))).toBe("heading");
  });
  it("a NON-global property (aria-checked) does not rescue a presentational role", () => {
    expect(computeRole(el(`<h2 role="presentation" aria-checked="true">x</h2>`))).toBe(null);
  });
  it("the injected core carries the same global list (parity)", () => {
    const m = /var attrs = (\[[^\]]*\]);/.exec(ROLES_SRC);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1])).toEqual(GLOBAL_ARIA);
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
