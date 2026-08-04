/**
 * Tests for the eager-chunk gate's HTML parsing (scripts/check-eager-chunks.mjs).
 *
 * The gate's whole value is that it NEVER silently stops matching: if Vite
 * reorders attributes or switches quote style in dist/index.html, the parser
 * must still find every modulepreload link and script src. These tests pin
 * that contract (Codex audit finding: the original regex only matched
 * double-quoted, rel-before-href markup).
 */
import { describe, it, expect } from "vitest";
import {
  collectEagerAssets,
  findOffenders,
  DENYLIST,
  staticImportsOf,
  buildStaticGraph,
  staticClosurePaths,
  findBootChunks,
  BOOT_CHUNK_PATTERNS,
  findLazyOnlyViolations,
  LAZY_ONLY_CHUNK_PATTERNS,
  // @ts-expect-error — plain .mjs module without type declarations
} from "./check-eager-chunks.mjs";

function assets(html: string): string[] {
  return collectEagerAssets(html) as string[];
}

function imports(code: string): string[] {
  return staticImportsOf(code) as string[];
}

function graphOf(chunks: Record<string, string>): Map<string, string[]> {
  return buildStaticGraph(Object.entries(chunks)) as Map<string, string[]>;
}

function closure(seeds: string[], chunks: Record<string, string>): Map<string, string[]> {
  return staticClosurePaths(seeds, graphOf(chunks)) as Map<string, string[]>;
}

describe("collectEagerAssets — modulepreload links", () => {
  it("matches the current Vite output shape (rel, crossorigin, href, double quotes)", () => {
    const html =
      '<link rel="modulepreload" crossorigin href="/assets/vendor-codemirror-abc.js">';
    expect(assets(html)).toEqual(["/assets/vendor-codemirror-abc.js"]);
  });

  it("matches when href comes before rel", () => {
    const html = '<link href="/assets/a.js" crossorigin rel="modulepreload">';
    expect(assets(html)).toEqual(["/assets/a.js"]);
  });

  it("matches single-quoted attributes", () => {
    const html = "<link rel='modulepreload' href='/assets/b.js'>";
    expect(assets(html)).toEqual(["/assets/b.js"]);
  });

  it("matches unquoted attribute values", () => {
    const html = "<link rel=modulepreload href=/assets/c.js>";
    expect(assets(html)).toEqual(["/assets/c.js"]);
  });

  it("matches with extra attributes interleaved", () => {
    const html =
      '<link data-x="1" rel="modulepreload" as="script" integrity="sha384-x" href="/assets/d.js" fetchpriority="high">';
    expect(assets(html)).toEqual(["/assets/d.js"]);
  });

  it("finds multiple links on a single line", () => {
    const html =
      '<link rel="modulepreload" href="/assets/a.js"><link href="/assets/b.js" rel="modulepreload">';
    expect(assets(html)).toEqual(["/assets/a.js", "/assets/b.js"]);
  });

  it("honors rel as a space-separated token list", () => {
    const html = '<link rel="preload modulepreload" href="/assets/e.js">';
    expect(assets(html)).toEqual(["/assets/e.js"]);
  });

  it("does NOT match rel=stylesheet links", () => {
    const html = '<link rel="stylesheet" crossorigin href="/assets/index.css">';
    expect(assets(html)).toEqual([]);
  });

  it("does NOT match rel values merely containing the substring", () => {
    // "notmodulepreload" is not the modulepreload token.
    const html = '<link rel="notmodulepreload" href="/assets/f.js">';
    expect(assets(html)).toEqual([]);
  });

  it("ignores modulepreload links without an href", () => {
    expect(assets('<link rel="modulepreload">')).toEqual([]);
  });
});

describe("collectEagerAssets — script tags", () => {
  it("matches <script type=module src> regardless of attribute order", () => {
    const html = '<script src="/assets/index-xyz.js" type="module" crossorigin></script>';
    expect(assets(html)).toEqual(["/assets/index-xyz.js"]);
  });

  it("matches single-quoted script src", () => {
    const html = "<script type='module' src='/assets/main.js'></script>";
    expect(assets(html)).toEqual(["/assets/main.js"]);
  });

  it("ignores inline scripts without src", () => {
    expect(assets('<script>const src = "/assets/fake.js";</script>')).toEqual([]);
  });
});

describe("findOffenders", () => {
  it("flags hrefs containing a denylisted chunk family", () => {
    const eager = [
      "/assets/vendor-codemirror-abc.js",
      "/assets/vendor-mermaid-def.js",
      "/assets/vendor-graphviz-ghi.js",
    ];
    expect(findOffenders(eager, DENYLIST)).toEqual([
      "/assets/vendor-mermaid-def.js",
      "/assets/vendor-graphviz-ghi.js",
    ]);
  });

  it("returns empty for a clean preload list", () => {
    expect(findOffenders(["/assets/vendor-codemirror-abc.js"], DENYLIST)).toEqual([]);
  });
});

describe("end-to-end over realistic index.html", () => {
  it("collects both preloads and the entry script from a Vite-shaped document", () => {
    const html = [
      "<!doctype html>",
      "<html><head>",
      '<script type="module" crossorigin src="/assets/index-B1.js"></script>',
      '<link rel="modulepreload" crossorigin href="/assets/rolldown-runtime-Q1.js">',
      '<link rel="modulepreload" crossorigin href="/assets/vendor-codemirror-C1.js">',
      '<link rel="stylesheet" crossorigin href="/assets/index-S1.css">',
      "</head><body></body></html>",
    ].join("\n");
    expect(assets(html)).toEqual([
      "/assets/rolldown-runtime-Q1.js",
      "/assets/vendor-codemirror-C1.js",
      "/assets/index-B1.js",
    ]);
  });
});

/**
 * WI-12 — the cold-start graph beyond index.html.
 *
 * `dist/index.html` lists only the ENTRY chunk's static graph. The app is
 * reached through `await import("./App")` in main.tsx's bootstrap(), so every
 * chunk under App is cold-start and invisible to the HTML. These cases pin the
 * closure walk that closed that hole.
 */
describe("staticImportsOf — static vs dynamic edges in built chunks", () => {
  it("reads every static form rolldown emits", () => {
    const code = [
      `import{a as x}from"./named-A1.js";`,
      `import"./bare-B1.js";`,
      `import def from"./default-C1.js";`,
      `import*as ns from"./ns-D1.js";`,
      `export{y}from"./reexport-E1.js";`,
      `export*from"./star-F1.js";`,
    ].join("");
    expect(imports(code).sort()).toEqual([
      "bare-B1.js",
      "default-C1.js",
      "named-A1.js",
      "ns-D1.js",
      "reexport-E1.js",
      "star-F1.js",
    ]);
  });

  it("does not treat a dynamic import as a static edge (backtick form included)", () => {
    // Rolldown emits dynamic specifiers in backticks; the double-quoted form is
    // still accepted so the gate does not depend on that detail.
    const code = 'await import(`./lazy-A1.js`);await import("./lazy-B1.js");';
    expect(imports(code)).toEqual([]);
  });

  it("still reports a chunk imported BOTH ways — the subtraction is per specifier", () => {
    const code = 'import{a}from"./both-A1.js";const f=()=>import(`./both-A1.js`);';
    expect(imports(code)).toEqual(["both-A1.js"]);
  });

  it("ignores preload-manifest paths, which are not relative specifiers", () => {
    const code = '__vitePreload(f,["assets/App-A1.js","assets/vendor-x-B1.js"]);';
    expect(imports(code)).toEqual([]);
  });
});

describe("staticClosurePaths", () => {
  const chunks = {
    "entry-A1.js": 'import"./shared-B1.js";await import(`./App-C1.js`);',
    "shared-B1.js": "",
    "App-C1.js": 'import"./vendor-xyflow-D1.js";',
    "vendor-xyflow-D1.js": 'import"./vendor-mermaid-E1.js";',
    "vendor-mermaid-E1.js": "",
    "unreached-F1.js": 'import"./vendor-graphviz-G1.js";',
    "vendor-graphviz-G1.js": "",
  };

  it("does not reach a dynamically-imported chunk from the entry alone", () => {
    const reached = closure(["entry-A1.js"], chunks);
    expect([...reached.keys()].sort()).toEqual(["entry-A1.js", "shared-B1.js"]);
  });

  it("reaches transitively once the boot chunk is a seed — the App hole", () => {
    const reached = closure(["entry-A1.js", "App-C1.js"], chunks);
    expect(reached.has("vendor-xyflow-D1.js")).toBe(true);
    expect(reached.has("vendor-mermaid-E1.js")).toBe(true);
    expect(reached.has("vendor-graphviz-G1.js")).toBe(false);
  });

  it("records the import chain so a failure can name the path, not just the chunk", () => {
    const reached = closure(["App-C1.js"], chunks);
    expect(reached.get("vendor-mermaid-E1.js")).toEqual([
      "App-C1.js",
      "vendor-xyflow-D1.js",
      "vendor-mermaid-E1.js",
    ]);
  });

  it("ignores seeds that are not chunks (hashed stylesheets, missing files)", () => {
    expect(closure(["index-S1.css", "gone-Z9.js"], chunks).size).toBe(0);
  });

  it("terminates on a cycle", () => {
    const cyclic = { "a-A1.js": 'import"./b-B1.js";', "b-B1.js": 'import"./a-A1.js";' };
    expect([...closure(["a-A1.js"], cyclic).keys()].sort()).toEqual(["a-A1.js", "b-B1.js"]);
  });
});

describe("findBootChunks", () => {
  it("finds the App chunk under its content hash", () => {
    const found = findBootChunks(["entry-A1.js", "App-DKyjghVp.js", "AppShell-B2.js"]) as {
      matches: string[];
    }[];
    expect(found.map((f) => f.matches)).toEqual([["App-DKyjghVp.js"]]);
  });

  it("reports no match when the boot chunk is renamed — the gate must fail closed", () => {
    const found = findBootChunks(["entry-A1.js", "Shell-DKyjghVp.js"]) as { matches: string[] }[];
    expect(found.every((f) => f.matches.length === 0)).toBe(true);
  });

  it("keeps the boot pattern list non-empty", () => {
    // An empty list would silently reduce the gate to its pre-WI-12 blindness.
    expect((BOOT_CHUNK_PATTERNS as RegExp[]).length).toBeGreaterThan(0);
  });
});

describe("DENYLIST covers the graph families WI-12 made lazy", () => {
  it.each(["vendor-xyflow", "vendor-dagre"])("denylists %s", (family) => {
    expect(DENYLIST as string[]).toContain(family);
  });

  it("flags them by chunk name in the closure output", () => {
    const reachable = ["App-C1.js", "vendor-xyflow-D1.js", "vendor-dagre-E1.js"];
    expect(findOffenders(reachable, DENYLIST)).toEqual([
      "vendor-xyflow-D1.js",
      "vendor-dagre-E1.js",
    ]);
  });
});

/**
 * WI-13 — the format-registry surfaces, checked as LAZY-ONLY.
 *
 * `bootstrapFormats()` runs before `import("./App")` in EVERY window, so a
 * static edge from an adapter to its editor surface is cold-start cost for
 * Settings and PDF-export windows too. The denylist cannot express this class:
 * an app module that regresses to a static import stops being a chunk at all,
 * so its name disappears and name-matching reports clean exactly when the
 * regression lands. Hence existence AND closure membership, both checked.
 */
describe("findLazyOnlyViolations", () => {
  const patterns = [
    { re: /^markdownSurface-[^/]*\.js$/, why: "markdown WYSIWYG surface" },
    { re: /^yamlWorkflowRenderer-[^/]*\.js$/, why: "gha workflow renderer" },
  ];

  function violations(names: string[], reachable: string[]) {
    return findLazyOnlyViolations(names, new Map(reachable.map((n) => [n, [n]])), patterns) as {
      kind: string;
      chunk?: string;
      pattern: string;
    }[];
  }

  it("passes when every surface exists as its own chunk and none is reachable", () => {
    expect(
      violations(
        ["entry-A1.js", "markdownSurface-B1.js", "yamlWorkflowRenderer-C1.js"],
        ["entry-A1.js"],
      ),
    ).toEqual([]);
  });

  it("fails CLOSED when a surface chunk is missing — the inlined-by-static-import case", () => {
    // This is the regression the denylist cannot see: no chunk, no name, no
    // match. Absence has to be the failure, not the pass.
    const found = violations(["entry-A1.js", "markdownSurface-B1.js"], ["entry-A1.js"]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "missing" });
    expect(found[0]!.pattern).toContain("yamlWorkflowRenderer");
  });

  it("fails when the chunk exists but sits on the cold-start closure", () => {
    const found = violations(
      ["entry-A1.js", "markdownSurface-B1.js", "yamlWorkflowRenderer-C1.js"],
      ["entry-A1.js", "markdownSurface-B1.js"],
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "eager", chunk: "markdownSurface-B1.js" });
  });

  it("reports every violating chunk when one pattern matches several", () => {
    const found = violations(
      ["markdownSurface-B1.js", "markdownSurface-B2.js", "yamlWorkflowRenderer-C1.js"],
      ["markdownSurface-B1.js", "markdownSurface-B2.js"],
    );
    expect(found.map((v) => v.chunk)).toEqual([
      "markdownSurface-B1.js",
      "markdownSurface-B2.js",
    ]);
  });

  it("does not match a same-prefix chunk that is not the surface", () => {
    // `markdownSurfaceHelpers-*.js` must not satisfy the markdownSurface rule.
    const found = violations(
      ["markdownSurfaceHelpers-B1.js", "yamlWorkflowRenderer-C1.js"],
      [],
    );
    expect(found.map((v) => v.kind)).toEqual(["missing"]);
  });
});

describe("LAZY_ONLY_CHUNK_PATTERNS — the shipped list", () => {
  const patterns = LAZY_ONLY_CHUNK_PATTERNS as { re: RegExp; why: string }[];

  it("is non-empty (an empty list silently disables the rule)", () => {
    expect(patterns.length).toBeGreaterThan(0);
  });

  it.each([
    ["markdownSurface-abc123.js", "markdown WYSIWYG surface"],
    ["yamlWorkflowRenderer-abc123.js", "gha workflow schemaRenderer"],
    ["sourceGhaIrSync-abc123.js", "gha IR sync"],
    ["sourceWorkflowCompletion-abc123.js", "expression completion"],
    ["sourceWorkflowCursorSync-abc123.js", "cursor sync"],
    ["sourceWorkflowGoto-abc123.js", "goto-def"],
  ])("covers %s (%s)", (chunk) => {
    expect(patterns.some((p) => p.re.test(chunk))).toBe(true);
  });

  it("gives every pattern a reason, so a future reader can retire it", () => {
    for (const p of patterns) expect(p.why.length).toBeGreaterThan(10);
  });

  it("does NOT list vendor-codemirror or vendor-tiptap on the denylist", () => {
    // Both stay on the cold-start closure through non-registry paths (App's
    // own graph reaches @tiptap/pm via lintEngine → headingSlug; the vite
    // preload helper rides vendor-codemirror-languages). Listing them would be
    // a gate that can never go green.
    expect(DENYLIST as string[]).not.toContain("vendor-codemirror");
    expect(DENYLIST as string[]).not.toContain("vendor-tiptap");
  });
});
