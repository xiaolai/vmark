// @vitest-environment node
/**
 * WI-3.1 — the dialect drift gate.
 *
 * Four parse modes existed as four independently maintained plugin lists: the
 * editor's conditional chain, the lint chain, the `<details>` body parser and
 * the inline-summary parser. Adding a plugin to one changed what that mode
 * could parse relative to the others, silently — and the deltas that already
 * existed were implied by which imports a file happened to have.
 *
 * Two halves, and the second is the one that matters:
 *   1. The DECLARATION is total — `Record<ParseMode, Membership>` makes a
 *      missing mode a compile error, so this file only checks the parts the
 *      type system cannot: that every delta carries a reason, and that no
 *      descriptor is a no-op.
 *   2. The BUILT processors match the declaration. A description nobody
 *      constructs from is a second list to drift; `attachers` is introspected
 *      so the gate compares against what unified actually runs.
 *
 * @coordinates-with utils/markdownPipeline/dialect.ts
 * @coordinates-with utils/markdownPipeline/parser/processorFactory.ts
 * @module utils/markdownPipeline/dialect.test
 */
import { describe, it, expect, vi } from "vitest";
import {
  DIALECT,
  PARSE_MODES,
  cacheKeyForMode,
  conditionalFlags,
  pluginsForMode,
  unconditionalNames,
  type DialectContext,
  type ParseMode,
} from "./dialect";
import { createProcessor, createMarkdownProcessor } from "./parser/processorFactory";

/** The plugin function names a built unified processor actually runs. */
function attacherNames(processor: unknown): string[] {
  const { attachers } = processor as { attachers: [{ name?: string }][] };
  return attachers.map(([fn]) => fn.name ?? "(anonymous)");
}

describe("the declaration is complete and non-vacuous", () => {
  it("gives every plugin a membership for every mode", () => {
    // Belt and braces: the Record type already enforces this at compile time.
    for (const d of DIALECT) {
      expect(Object.keys(d.modes).sort()).toEqual([...PARSE_MODES].sort());
    }
  });

  it("states a reason for every plugin", () => {
    const unexplained = DIALECT.filter((d) => d.reason.trim().length < 20);
    expect(unexplained.map((d) => d.name)).toEqual([]);
  });

  it("has no plugin absent from every mode", () => {
    // A descriptor nothing runs is dead weight pretending to be policy.
    const orphans = DIALECT.filter((d) =>
      PARSE_MODES.every((m) => d.modes[m] === "never")
    );
    expect(orphans.map((d) => d.name)).toEqual([]);
  });

  it("declares unique plugin names", () => {
    const names = DIALECT.map((d) => d.name);
    expect(names.length).toBe(new Set(names).size);
  });
});

describe("the built processors match the declaration", () => {
  it("source-position runs exactly its unconditional set, in order", () => {
    // This mode loads everything: no content sniffing, so positions never
    // depend on what the document happens to contain.
    expect(attacherNames(createMarkdownProcessor())).toEqual(
      unconditionalNames("source-position")
    );
  });

  it("document with no features runs only its always-on plugins", () => {
    expect(attacherNames(createProcessor("plain paragraph"))).toEqual(
      unconditionalNames("document")
    );
  });

  it.each([
    { flag: "math", markdown: "$x^2$", plugins: ["remarkMath", "remarkValidateMath"] },
    { flag: "frontmatter", markdown: "---\na: 1\n---\n\nbody", plugins: ["remarkFrontmatter"] },
    { flag: "wiki links", markdown: "a [[link]] b", plugins: ["remarkWikiLinks"] },
    { flag: "details", markdown: "<details><summary>s</summary>\n\nb\n\n</details>", plugins: ["remarkDetailsBlock"] },
  ])("document adds $flag plugins only when the content has it", ({ markdown, plugins }) => {
    const withFeature = attacherNames(createProcessor(markdown));
    const without = attacherNames(createProcessor("plain paragraph"));
    for (const p of plugins) {
      expect(withFeature).toContain(p);
      expect(without).not.toContain(p);
    }
  });

  it("document adds remarkBreaks only under preserveLineBreaks", () => {
    expect(attacherNames(createProcessor("a", { preserveLineBreaks: true }))).toContain(
      "remarkBreaks"
    );
    expect(attacherNames(createProcessor("a"))).not.toContain("remarkBreaks");
  });
});

describe("the deltas between modes are the declared ones", () => {
  const namesFor = (m: ParseMode) => pluginsForMode(m).map((d) => d.name);

  it("details-body excludes remarkDetailsBlock — the recursion guard", () => {
    // A body parser that registered the details plugin would need a body
    // parser, without bound. This is the single most important delta.
    expect(namesFor("details-body")).not.toContain("remarkDetailsBlock");
    expect(namesFor("document")).toContain("remarkDetailsBlock");
  });

  it("details-body is a REDUCED dialect, not the document one", () => {
    const body = new Set(namesFor("details-body"));
    for (const absent of [
      "remarkDetailsBlock",
      "remarkTocBlock",
      "remarkValidateMath",
      "remarkDisableSetextHeadings",
      "remarkBreaks",
    ]) {
      expect(body.has(absent)).toBe(false);
    }
  });

  it("inline-summary is the smallest dialect that still has inline marks", () => {
    expect(namesFor("inline-summary")).toEqual([
      "remarkParse",
      "remarkGfm",
      "remarkDepthLimit",
      "remarkCustomInline",
    ]);
  });

  it("source-position never runs a REPAIRING plugin", () => {
    // Its contract is the offsets of the text as written. A plugin that
    // rewrites the tree to fix a misparse breaks exactly that.
    const raw = new Set(namesFor("source-position"));
    expect(raw.has("remarkDisableSetextHeadings")).toBe(false);
    expect(raw.has("remarkBreaks")).toBe(false);
  });

  it("every mode agrees on inline mark semantics", () => {
    // `singleTilde: false` everywhere, or `~x~` is deletion in one dialect and
    // subscript in another for identical text.
    for (const mode of PARSE_MODES) {
      const gfm = pluginsForMode(mode).find((d) => d.name === "remarkGfm");
      expect(gfm?.options).toEqual({ singleTilde: false });
      expect(namesFor(mode)).toContain("remarkCustomInline");
    }
  });
});

describe("the processor cache keys on every flag that changes the stack", () => {
  it("distinguishes documents that need different plugin sets", () => {
    // processorFactory's own header records the bug: a flag added to the stack
    // but not to the cache key meant a processor built for a document needing
    // setext suppressed was reused for one that did not. Derived from the
    // descriptors so adding a conditional plugin cannot leave the key behind.
    const distinct = new Set(
      [
        "plain",
        "$x$",
        "---\na: 1\n---\n\nb",
        "[[w]]",
        "<details><summary>s</summary>\n\nb\n\n</details>",
        "text\n  -\n",
      ].map((md) => attacherNames(createProcessor(md)).join("|"))
    );

    // Six inputs, six different stacks — no two collide on one cached entry.
    expect(distinct.size).toBe(6);
  });

  it("preserveLineBreaks changes the stack, so it must be part of the key", () => {
    expect(attacherNames(createProcessor("a", { preserveLineBreaks: true }))).not.toEqual(
      attacherNames(createProcessor("a"))
    );
  });

  it("gives a DIFFERENT key for every conditional flag, one at a time", () => {
    // Tests the key itself, not a list mirroring the helper. Comparing
    // `conditionalFlags()` to a hardcoded array proved only that two lists I
    // wrote agreed — production still enumerated by hand, so the guarantee was
    // false. Flipping each flag must move the key, or the cache can serve a
    // processor built for a different plugin stack.
    const base: DialectContext = {
      hasMath: false,
      hasFrontmatter: false,
      hasWikiLinks: false,
      hasDetails: false,
      hasAmbiguousListUnderline: false,
      preserveLineBreaks: false,
    };
    const baseKey = cacheKeyForMode("document", base);

    for (const flag of conditionalFlags()) {
      expect(cacheKeyForMode("document", { ...base, [flag]: true })).not.toBe(baseKey);
    }
  });

  it("gives every flag combination a DISTINCT key", () => {
    const flags = conditionalFlags();
    const keys = new Set<string>();
    for (let mask = 0; mask < 1 << flags.length; mask += 1) {
      const context = Object.fromEntries(
        flags.map((f, i) => [f, Boolean(mask & (1 << i))])
      ) as unknown as DialectContext;
      keys.add(cacheKeyForMode("document", context));
    }
    // A collision means two different plugin stacks share one cached processor.
    expect(keys.size).toBe(1 << flags.length);
  });

  it("keys different MODES apart", () => {
    const context = {
      hasMath: true,
      hasFrontmatter: true,
      hasWikiLinks: true,
      hasDetails: true,
      hasAmbiguousListUnderline: true,
      preserveLineBreaks: true,
    } as DialectContext;
    expect(cacheKeyForMode("document", context)).not.toBe(
      cacheKeyForMode("source-position", context)
    );
  });
});

describe("the details-body DEFAULT matches the declared table", () => {
  it("builds exactly the plugins the table declares, in order", async () => {
    // detailsBodyParser.ts builds its own chain from leaf imports so the plugin
    // works without importing dialect.ts — the fix for a production break. That
    // second construction site is only safe while it agrees with the table.
    //
    // resetModules FIRST, and import the parser WITHOUT ../dialect: this file
    // imports the dialect at module load, which wires and memoizes the
    // DESCRIPTOR-built processor. Comparing that to the descriptors compares
    // the table with itself — the drift gate passed while testing nothing,
    // which an independent verification caught.
    vi.resetModules();
    const { getDetailsBodyParser } = await import("./plugins/detailsBodyParser");
    const processor = getDetailsBodyParser() as unknown as {
      attachers: [{ name?: string }][];
    };
    const { pluginsForMode: freshPluginsForMode } = await import("./dialectQueries");

    expect(processor.attachers.map(([fn]) => fn.name)).toEqual(
      freshPluginsForMode("details-body").map((d) => d.name)
    );
  });
});
