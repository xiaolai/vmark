// S-09 / S-06 — the TypeScript mirror's name computation: Unicode
// normalisation, the content-walk rules, the landmark rule and the cap. The
// injected core is held to the same answers by `ariaParity.test.ts`.
import { describe, it, expect, vi } from "vitest";
import { normalize, accessibleName, NAME_CAP, CONTENT_BUDGET } from "./ariaName";

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
  it.each([
    "\u200B", "\u200C", "\u200D", "\u200E", "\u200F", "\u202A", "\u202E", "\u2060", "\u2064", "\uFEFF", "\u00AD",
    "\u2066", "\u2067", "\u2068", "\u2069", "\u061C", "\u0600", "\u0605", "\u06DD", "\u070F", "\u0890", "\u0891", "\u08E2", "\u180E",
  ])(
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
  it("format characters never spend the content budget: 3,200 bidi controls before a name leave the name (#105)", () => {
    expect(accessibleName(el(`<button>${"\u202E".repeat(3200)}Save</button>`))).toBe("Save");
    expect(accessibleName(el(`<button>${"\u200B".repeat(5000)}<span>Deep</span></button>`))).toBe("Deep");
  });
  it("leading whitespace does not spend the content budget, and a huge first node is sliced, not appended (#105)", () => {
    expect(accessibleName(el(`<button>${" ".repeat(5000)}Save</button>`))).toBe("Save");
    expect(accessibleName(el(`<button>${"x".repeat(NAME_CAP * 40)}<span>tail</span></button>`))).toHaveLength(NAME_CAP);
    expect(accessibleName(el(`<button>${"\n\t ".repeat(2000)}<span>Deep</span> name</button>`))).toBe("Deep name");
  });
});

// #105 — the content walk is a cursor over the live child list (never a copied
// list pushed before the budget is checked) and gathers text a window at a time
// (never a stripped copy of a whole text node). The injected core is held to the
// same bounds by ariaParity.test.ts.
describe("content walk bounds (#105)", () => {
  it("the content budget is many times the cap, so a whitespace-heavy name still fills it", () => {
    expect(CONTENT_BUDGET).toBe(NAME_CAP * 16);
  });

  it("a button a billion text children wide costs a cursor: at most CONTENT_BUDGET+1 children are ever read", () => {
    const reads: number[] = [];
    const kids = new Proxy(
      {},
      {
        get(_t, key) {
          if (key === "length") return 1_000_000_000;
          const i = typeof key === "string" ? Number(key) : NaN;
          if (!Number.isInteger(i)) return undefined;
          reads.push(i);
          if (reads.length > CONTENT_BUDGET + 1) throw new Error(`read past the budget: ${reads.length} reads`);
          return document.createTextNode("x");
        },
      },
    );
    const btn = document.createElement("button");
    Object.defineProperty(btn, "childNodes", { get: () => kids });
    expect(accessibleName(btn)).toBe("x".repeat(NAME_CAP));
    expect(reads.length).toBeLessThanOrEqual(CONTENT_BUDGET + 1);
  });

  it("a text node holding megabytes is read a window at a time: no replace ever runs over more than CONTENT_BUDGET characters", () => {
    const btn = document.createElement("button");
    btn.appendChild(document.createTextNode(`${"\u200B".repeat(CONTENT_BUDGET)}${"y".repeat(5_000_000)}`));
    const original = String.prototype.replace;
    const receivers: number[] = [];
    const spy = vi.spyOn(String.prototype, "replace").mockImplementation(function (this: string, ...args: unknown[]) {
      receivers.push(this.length);
      return (original as unknown as (...a: unknown[]) => string).apply(this, args);
    });
    try {
      // The zero-width flood fills the first window and strips to nothing; the
      // visible text in the NEXT window still names.
      expect(accessibleName(btn)).toBe("y".repeat(NAME_CAP));
    } finally {
      spy.mockRestore();
    }
    expect(receivers.length).toBeGreaterThan(0);
    expect(Math.max(...receivers)).toBeLessThanOrEqual(CONTENT_BUDGET);
  });

  it("whitespace is merged across windows and never spends the budget", () => {
    // 3 windows of spaces, then the name: the collapsed output is one space per
    // window at most, and adjacent window spaces merge into one.
    expect(accessibleName(el(`<button>${" ".repeat(CONTENT_BUDGET * 3)}Save</button>`))).toBe("Save");
    expect(accessibleName(el(`<button>a${" ".repeat(CONTENT_BUDGET * 2)}b</button>`))).toBe("a b");
  });
});
