// WI-NB1.1 — the injected library's ASSEMBLY. Behaviour is tested where it is
// executed (actScript.test.ts in jsdom, actScript.webkit.test.ts in real
// WebKit, both through the builders); this pins that the assembled library
// actually carries every section, so a dropped concat member cannot ship as a
// page-side ReferenceError.
import { describe, it, expect } from "vitest";
import { AGENT_LIB } from "./agentLib";
import { AGENT_CORE_SRC } from "./agentCore";

describe("AGENT_LIB assembly", () => {
  it.each([
    "__vmarkRole",
    "__vmarkName",
    "__vmarkRefFor",
    "__vmarkQueryByRef",
    "__vmarkQuery",
    "__vmarkQueryAll",
    "__vmarkSnapshot",
    "__vmarkHidden",
    "__vmarkRendered",
    "__vmarkClick",
    "__vmarkType",
    "__vmarkClickRef",
    "__vmarkTypeRef",
  ])("defines %s", (name) => {
    expect(AGENT_LIB).toContain(`function ${name}(`);
  });

  it("is standalone ES5 — no import/export reaches the page", () => {
    expect(AGENT_LIB).not.toMatch(/\bimport\b|\bexport\b/);
  });
});

describe("AGENT_LIB is assembled on the shared core (S-02)", () => {
  it("starts with the core asset, so every builder ships one role/name implementation", () => {
    expect(AGENT_LIB.startsWith(AGENT_CORE_SRC)).toBe(true);
  });

  it.each(["__vmarkAll", "__vmarkHiddenBy", "__vmarkNotActable", "__vmarkDescribe", "__vmarkUnreachable", "__vmarkNameFull", "__vmarkPageText", "__vmarkOcclusion"])(
    "defines %s",
    (name) => {
      expect(AGENT_LIB).toContain(`function ${name}(`);
    },
  );

  it("defines each function exactly once — the core is never inlined a second time", () => {
    const names = [...AGENT_LIB.matchAll(/^function\s+(__vmark\w+)\s*\(/gm)].map((m) => m[1]);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });
});

// S-12: `by` (the occluder's description) is page-controlled text that reaches
// the model's failure hint verbatim. It is now tag + up to two class tokens,
// every token `[A-Za-z0-9_-]` and ≤ 32 chars, ≤ 64 in total.
describe("__vmarkDescribe is a bounded, sanitised description (S-12)", () => {
  function describe_(html: string): string {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    const fn = new Function("document", `${AGENT_LIB}\nreturn JSON.stringify(__vmarkDescribe(document.body.firstElementChild));`);
    return JSON.parse(fn(doc) as string) as string;
  }

  it("is tag plus at most two class tokens", () => {
    expect(describe_(`<div class="a b c">x</div>`)).toBe("div.a.b");
    expect(describe_(`<span>x</span>`)).toBe("span");
    expect(describe_(`<my-widget class="ok">x</my-widget>`)).toBe("my-widget.ok");
  });

  it("drops a 500-char class token and any token with characters outside [A-Za-z0-9_-]", () => {
    expect(describe_(`<div class="${"z".repeat(500)} ok">x</div>`)).toBe("div.ok");
    expect(describe_(`<div class="a:b c/d e.f ok_1">x</div>`)).toBe("div.ok_1");
    expect(describe_(`<div class="&lt;script&gt; ok">x</div>`)).toBe("div.ok");
  });

  it("never exceeds 64 characters in total", () => {
    const desc = describe_(`<div class="${"a".repeat(32)} ${"b".repeat(32)}">x</div>`);
    expect(desc.length).toBeLessThanOrEqual(64);
    expect(desc.startsWith("div.aaaa")).toBe(true);
  });

  it("handles an SVG element whose className is not a string", () => {
    expect(describe_(`<svg class="icon"><rect/></svg>`)).toBe("svg.icon");
  });
});
