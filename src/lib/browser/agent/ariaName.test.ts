// S-09 / S-06 — the TypeScript mirror's name computation: Unicode
// normalisation, the content-walk rules, the landmark rule and the cap. The
// injected core is held to the same answers by `ariaParity.test.ts`.
import { describe, it, expect } from "vitest";
import { normalize, accessibleName, NAME_CAP } from "./ariaName";

function el(html: string): Element {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body.firstElementChild!;
}

describe("normalize", () => {
  it("collapses whitespace and trims", () => {
    expect(normalize(" a \n\t b ")).toBe("a b");
  });
  it("NFC-normalises", () => {
    expect(normalize("é")).toBe("é");
  });
  it.each(["\u200B", "\u200C", "\u200D", "\u200E", "\u200F", "\u202A", "\u202E", "\u2060", "\u2064", "\uFEFF", "\u00AD"])(
    "strips format character U+%s",
    (ch) => {
      expect(normalize(`Publ${ch}ish`)).toBe("Publish");
    },
  );
  it("does not strip ordinary letters, CJK or RTL", () => {
    expect(normalize("发布 نشر Publish")).toBe("发布 نشر Publish");
  });
});

describe("accessibleName", () => {
  it("skips hidden descendants and script/style; includes img alt; treats <br> as a space", () => {
    expect(accessibleName(el(`<button>Save <span hidden>draft</span><script>1</script></button>`))).toBe("Save");
    expect(accessibleName(el(`<button><img alt="Download"></button>`))).toBe("Download");
    expect(accessibleName(el(`<button>a<br>b</button>`))).toBe("a b");
  });
  it("names a landmark from its label/title only, never its content", () => {
    expect(accessibleName(el(`<nav>Home About</nav>`))).toBe("");
    expect(accessibleName(el(`<nav aria-label="Primary">Home</nav>`))).toBe("Primary");
    expect(accessibleName(el(`<main title="Body">text</main>`))).toBe("Body");
  });
  it("caps the name at NAME_CAP characters", () => {
    expect(NAME_CAP).toBe(200);
    expect(accessibleName(el(`<button>${"x".repeat(300)}</button>`))).toHaveLength(NAME_CAP);
  });
  it("a labelledby reference prefers the referenced element's aria-label and includes it even when hidden", () => {
    const doc = new DOMParser().parseFromString(
      `<body><span id="a" aria-label="Alpha" hidden>text</span><button aria-labelledby="a">b</button></body>`,
      "text/html",
    );
    expect(accessibleName(doc.querySelector("button")!)).toBe("Alpha");
  });
});
