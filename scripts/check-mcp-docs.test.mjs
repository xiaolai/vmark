// WI-NB9.1 — the MCP docs-drift gate's own tests (node tier, gates config).
import { describe, it, expect } from "vitest";
import { declaredActionSchemas, extractActions, shippedActions, toolName, toolSections, undocumented } from "./check-mcp-docs.mjs";

describe("extractActions", () => {
  it("pulls the action literals out of an enum declaration", () => {
    const src = `
      inputSchema: {
        action: z
          .enum(['read', 'screenshot', 'query'])
          .describe('The action to perform'),
      }`;
    expect(extractActions(src)).toEqual(["read", "screenshot", "query"]);
  });

  it("handles a multi-line enum", () => {
    const src = `action: z.enum([
      'act', 'open',
      'navigate',
    ]).describe('x')`;
    expect(extractActions(src)).toEqual(["act", "open", "navigate"]);
  });

  it("resolves an enum declared through a const array (coherence.ts: `z.enum(READ_ACTIONS)`)", () => {
    // Found 2026-09-07: the gate reported 37 actions while the sidecar shipped 41 —
    // coherence.ts declares its four actions as a const array, the literal-only
    // regex saw no enum, and the four were never checked against the docs.
    const src = `
      const READ_ACTIONS = ['status', 'edges', 'claims', 'contexts'] as const;
      export const tool = {
        inputSchema: {
          action: z.enum(READ_ACTIONS).describe('The action to perform'),
        },
      };`;
    expect(extractActions(src)).toEqual(["status", "edges", "claims", "contexts"]);
  });

  it("fails loudly when the const array behind an enum cannot be found", () => {
    expect(() => extractActions("action: z.enum(MYSTERY_ACTIONS)")).toThrow(/MYSTERY_ACTIONS/);
  });

  it("follows a sibling import to the const it names (browser.ts ← browserActions.ts), and still fails when the sibling lacks it", () => {
    const src = "import { BROWSER_ACTIONS, runBrowserAction } from './browserActions.js';\naction: z.enum(BROWSER_ACTIONS).describe('x')";
    const siblings = { browserActions: "export const BROWSER_ACTIONS = [\n  'act',\n  'open',\n] as const;" };
    expect(extractActions(src, (m) => siblings[m] ?? null)).toEqual(["act", "open"]);
    expect(() => extractActions(src, (m) => (m === "browserActions" ? "export const OTHER = ['x'];" : null))).toThrow(/neither this file nor a sibling/);
    expect(() => extractActions(src)).toThrow(/neither this file nor a sibling/);
  });

  it("returns [] for a tool with no action enum", () => {
    expect(extractActions("export const x = 1;")).toEqual([]);
  });

  it("reads EVERY action enum in a file, not just the first", () => {
    const src = "action: z.enum(['read']).describe('a'),\n// …\naction: z.enum(['write', 'read']).describe('b'),";
    expect(extractActions(src)).toEqual(["read", "write"]);
  });

  it("fails loudly on an `action` schema in a shape it cannot read, instead of returning [] for that file", () => {
    expect(() => extractActions("action: z.string().describe('x')")).toThrow(/1 `action` schema\(s\) declared but only 0 readable/);
    expect(() => extractActions("action: z.enum([]).describe('x')")).toThrow(/no string literal/);
  });

  it("fails on an unreadable `action` schema even when a readable enum sits beside it in the same file", () => {
    // Audit 20260907 #47: the whole-file guard fired only when NOTHING parsed,
    // so a second, unsupported schema next to a supported one shipped unchecked.
    const src = "action: z.enum(['read']).describe('a'),\n// …\naction: z.union([z.literal('x')]).describe('b'),";
    expect(() => extractActions(src)).toThrow(/2 `action` schema\(s\) declared but only 1 readable/);
  });

  it("counts an `action: NAME` schema inside an inputSchema as declared, so a schema built elsewhere fails closed (audit #47)", () => {
    // `action: ACTION_SCHEMA` is not `action: z…`, so the declared count used
    // to be 0 and the file shipped its actions unchecked.
    const src = "const ACTION_SCHEMA = z.enum(['read']);\nserver.registerTool({ name: 'x', inputSchema: { action: ACTION_SCHEMA.describe('a'), tabId: z.string() } }, h);";
    expect(declaredActionSchemas(src)).toBe(1);
    expect(() => extractActions(src)).toThrow(/1 `action` schema\(s\) declared but only 0 readable/);
    // A nested brace inside a describe string does not end the body early.
    expect(declaredActionSchemas("inputSchema: { tabId: z.string().describe('a { b'), action: OTHER }")).toBe(1);
    // The parameter annotation `action: unknown` outside an inputSchema, and a
    // schema in a comment, declare nothing; `action: z…` anywhere still does.
    expect(declaredActionSchemas("function f(action: unknown) {}\n// inputSchema: { action: GONE }\n/* action: z.enum(['x']) */")).toBe(0);
    expect(declaredActionSchemas("action: z.enum(['x'])")).toBe(1);
  });

  it("does not let a commented-out enum stand in for a declared schema it cannot read", () => {
    const src = "// action: z.enum(['old'])\ninputSchema: { action: ACTION_SCHEMA }";
    expect(() => extractActions(src)).toThrow(/declared but only 0 readable/);
  });

  it("takes every literal verbatim — digits, hyphens and capitals are not silently dropped", () => {
    const src = "action: z.enum(['wait_for2', 'Read', 'a-b', \"dq\"]).describe('x')";
    expect(extractActions(src)).toEqual(["wait_for2", "Read", "a-b", "dq"]);
  });

  it("ignores a comment inside the enum body and escapes a `$` in a const name", () => {
    const src = "const $ACTS = ['a', // 'not-an-action'\n 'b'] as const;\naction: z.enum($ACTS).describe('x')";
    expect(extractActions(src)).toEqual(["a", "b"]);
  });

  // audit R2 #73 — a spread beside a literal used to contribute actions the
  // docs gate never saw, while the "found no actions" guard stayed quiet.
  it("refuses an enum element it cannot read instead of taking the literals beside it", () => {
    const src = "const MORE = ['x'];\naction: z.enum([...MORE, 'wait']).describe('x')";
    expect(() => extractActions(src)).toThrow(/element text this gate cannot read/);
    expect(() => extractActions("action: z.enum([SOME_CONST, 'wait']).describe('x')")).toThrow(/cannot read/);
  });

  // audit R2 #75 — the const-array lookup scanned raw source, so a
  // commented-out declaration shadowed the live one.
  it("resolves the named array from CODE, not from a commented-out declaration", () => {
    const src = "// const ACTS = ['ghost'];\nconst ACTS = ['real'];\naction: z.enum(ACTS).describe('x')";
    expect(extractActions(src)).toEqual(["real"]);
  });
});

describe("toolName", () => {
  it("reads a literal name, resolves a same-file const, and fails on an identifier the file does not declare", () => {
    expect(toolName("server.registerTool({ name: 'session', title: 'x' }, h)")).toBe("session");
    expect(toolName("export const BROWSER_TOOL = 'browser' as const;\nserver.registerTool(\n  {\n    name: BROWSER_TOOL,\n  }, h)")).toBe("browser");
    expect(toolName("export const x = 1;")).toBeNull();
    expect(() => toolName("server.registerTool({ name: MYSTERY }, h)")).toThrow(/MYSTERY/);
  });

  // audit R2 #77 — the first TEXTUAL match won, so a registration quoted in a
  // description named the tool, and a second real registration was invisible.
  it("reads the registration from CODE and refuses a file with two of them", () => {
    const quoted = "const d = \"registerTool({ name: 'ghost',\";\nserver.registerTool({ name: 'real' }, h)";
    expect(toolName(quoted)).toBe("real");
    const two = "server.registerTool({ name: 'a' }, h)\nserver.registerTool({ name: 'b' }, h)";
    expect(() => toolName(two)).toThrow(/2 registerTool/);
  });
});

describe("undocumented — an affirmative entry inside the tool's own section (audit #50)", () => {
  const actions = [
    { file: "browser.ts", tool: "browser", action: "act" },
    { file: "browser.ts", tool: "browser", action: "brand_new" },
  ];
  const page = (browserBody, rest = "") => `# Ref\n\n## \`browser\`\n\n${browserBody}\n\n## \`browser_read\`\n\n${rest}\n\n## Errors\n\n\`brand_new\` errors here.\n`;

  it("flags an action with no entry, even when its code span appears in prose", () => {
    const doc = page("### `act`\n\nDoes things. Unlike `brand_new`, which is no longer supported.");
    expect(undocumented(actions, doc)).toEqual([{ file: "browser.ts", tool: "browser", action: "brand_new" }]);
  });

  it("does not accept an entry under ANOTHER tool's section, or outside every tool section", () => {
    const doc = page("### `act`\n", "### `brand_new`\n");
    expect(undocumented(actions, doc)).toEqual([{ file: "browser.ts", tool: "browser", action: "brand_new" }]);
    expect(undocumented([{ file: "x.ts", tool: "unknown_tool", action: "act" }], doc)).toHaveLength(1);
  });

  it("rejects an entry line that withdraws the action — a removal notice is not documentation (audit #50)", () => {
    for (const withdrawn of [
      "- `brand_new` — no longer supported",
      "* `brand_new` (deprecated; use `act`)",
      "| `brand_new` | removed in 0.9 |",
      "### `brand_new` — not yet implemented",
    ]) {
      expect(undocumented(actions, page(`### \`act\`\n\n${withdrawn}\n`)), withdrawn).toEqual([{ file: "browser.ts", tool: "browser", action: "brand_new" }]);
    }
    // An entry whose prose merely mentions what the action does NOT do is still an entry.
    expect(undocumented(actions, page("### `act`\n\n- `brand_new` — does not require approval\n"))).toEqual([]);
  });

  it("accepts a heading (also a shared one), a leading list item, and a leading table row", () => {
    const doc = page("### `act` / `brand_new`\n");
    expect(undocumented(actions, doc)).toEqual([]);
    expect(undocumented(actions, page("#### `act`\n\n- `brand_new` — the new one\n"))).toEqual([]);
    expect(undocumented(actions, page("### `act`\n\n| `brand_new` | string | Yes |\n"))).toEqual([]);
  });

  it("splits the page into tool sections by `## \\`tool\\`` headings, ending at any other level-2 heading", () => {
    const sections = toolSections(page("body-a", "body-b"));
    expect([...sections.keys()]).toEqual(["browser", "browser_read"]);
    expect(sections.get("browser").join("\n")).toContain("body-a");
    expect(sections.get("browser").join("\n")).not.toContain("body-b");
    expect(sections.get("browser_read").join("\n")).not.toContain("errors here");
  });

  // audit R2 #78 — a second `## `browser`` heading REPLACED the first
  // section's lines, so an action documented under the earlier one was
  // reported missing while its entry sat on the page.
  it("keeps both halves when a tool is documented under two headings", () => {
    const doc = [
      "# Ref", "", "## `browser`", "", "### `act`", "",
      "## Notes", "", "prose", "",
      "## `browser`", "", "### `brand_new`", "",
    ].join("\n");
    expect(toolSections(doc).get("browser").join("\n")).toContain("### `act`");
    expect(undocumented(actions, doc)).toEqual([]);
  });
});

describe("the shipped surface", () => {
  it("extracts a non-trivial set of actions from the real tools, each placed under its tool", () => {
    const actions = shippedActions();
    const names = actions.map((a) => a.action);
    expect(names).toContain("act");
    expect(names).toContain("workflow_run");
    expect(names).toContain("workflow_status");
    expect(names.length).toBeGreaterThan(10);
    expect(actions.find((a) => a.action === "act")?.tool).toBe("browser");
    expect(actions.find((a) => a.action === "workflow_status")?.tool).toBe("browser_read");
    expect(new Set(actions.map((a) => a.tool)).size).toBe(9);
  });
});
