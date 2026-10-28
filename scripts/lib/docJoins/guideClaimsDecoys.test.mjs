// WI-RA15C.10 — the guide's checkable claims read the code as code: a commented-out or stringified copy of a declaration never stands in for the real one
//
// Each case drifts the real declaration AND plants, before it, a copy that
// still holds the old value — in a comment, or inside a string literal. The
// claim must read the real (drifted) code and report it; reading the decoy
// would make the drift look like agreement.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../../check-doc-joins.mjs";
import { checkClaims } from "./guideClaims.mjs";
import { CLAIMS, CLAIM_PATHS } from "./guideClaimsTable.mjs";
import { arrayStrings, captureCode } from "./guideClaimsHelpers.mjs";
import { codeView } from "./codeView.mjs";

const realTexts = () => Object.fromEntries(Object.entries(CLAIM_PATHS).map(([k, rel]) => [k, readFileSync(resolve(ROOT, rel), "utf8")]));

/** The real tree with `key`'s text passed through `edit`; asserts the edit changed something. */
function drifted(key, edit) {
  const texts = realTexts();
  const next = edit(texts[key]);
  expect(next).not.toBe(texts[key]);
  return { ...texts, [key]: next };
}
const findingsFor = (texts, name) => checkClaims(CLAIMS, texts).filter((f) => f.startsWith(`${name}: `));
/** `s` with `from` replaced by `to`, asserting `from` occurs exactly once. */
const once = (s, from, to) => {
  expect(s.split(from)).toHaveLength(2);
  return s.replace(from, to);
};
/** The text from `start` (inclusive) to the first `end` after it (inclusive). */
const span = (s, start, end) => {
  const at = s.indexOf(start);
  expect(at).toBeGreaterThanOrEqual(0);
  return s.slice(at, s.indexOf(end, at) + end.length);
};
const lineCommented = (block) => block.split("\n").map((l) => `// ${l}`).join("\n");

describe("a decoy declaration does not stand in for the drifted real one", () => {
  it.each([
    ["prompt history size", "promptHistory", "line comment", (s) => `// const MAX_ENTRIES = 100\n${once(s, "const MAX_ENTRIES = 100", "const MAX_ENTRIES = 50")}`, /the guide says 100, the code says 50/],
    ["prompt history size", "promptHistory", "string literal", (s) => `const note = "const MAX_ENTRIES = 100";\n${once(s, "const MAX_ENTRIES = 100", "const MAX_ENTRIES = 50")}`, /the guide says 100, the code says 50/],
    ["prompt history size", "promptHistory", "template literal", (s) => `const note = \`const MAX_ENTRIES = 100\`;\n${once(s, "const MAX_ENTRIES = 100", "const MAX_ENTRIES = 50")}`, /the guide says 100, the code says 50/],
    ["IME grace period", "imeGuard", "block comment", (s) => `/* IME_GRACE_PERIOD_MS = 50 */\n${once(s, "IME_GRACE_PERIOD_MS = 50", "IME_GRACE_PERIOD_MS = 80")}`, /the guide says 50, the code says 80/],
    ["terminal hangup grace", "ptyChild", "doc comment", (s) => `/// HANGUP_GRACE: Duration = Duration::from_millis(1000)\n${once(s, "Duration::from_millis(1000)", "Duration::from_millis(2500)")}`, /the guide says 1000, the code says 2500/],
    ["terminal hangup grace", "ptyChild", "raw string", (s) => `const DOC: &str = r#"HANGUP_GRACE: Duration = Duration::from_millis(1000)"#;\n${once(s, "Duration::from_millis(1000)", "Duration::from_millis(2500)")}`, /the guide says 1000, the code says 2500/],
    ["MCP client credential key", "tokenField", "line comment", (s) => `// TOKEN_ENV_KEY: &str = "VMARK_MCP_TOKEN"\n${once(s, 'TOKEN_ENV_KEY: &str = "VMARK_MCP_TOKEN"', 'TOKEN_ENV_KEY: &str = "VMARK_TOKEN"')}`, /does not name `env.VMARK_TOKEN`/],
    ["sort lines are Source-only", "textActions", "line comment", (s) => `// sortLinesAsc: { supports: { wysiwyg: false } }\n${s.replace(/(sortLinesAsc: \{[^}]*?supports: \{ wysiwyg: )false/, "$1true")}`, /F4 row says Source mode only; sortLinesAsc supports WYSIWYG: true/],
    ["Git export branch", "gitExportNames", "line comment", (s) => `// format!("vmark-journal/{doc}")\n${once(s, 'format!("vmark-journal/{doc}")', 'format!("vmark-history/{doc}")')}`, /the guide says vmark-journal\/, the code says vmark-history\//],
  ])("%s (%s) — a %s decoy", (name, key, _kind, edit, expected) => {
    expect(findingsFor(drifted(key, edit), name).join("\n")).toMatch(expected);
  });

  it("external-editor names — a commented copy of KNOWN_EDITORS", () => {
    const texts = drifted("programNames", (s) => {
      const decl = span(s, "pub(super) const KNOWN_EDITORS", "];");
      return `/*\n${decl}\n*/\n${s.replace(/^ *"zed",\n/m, "")}`;
    });
    expect(findingsFor(texts, "external-editor names").join("\n")).toMatch(/`zed` is named as a known editor but is not in KNOWN_EDITORS/);
  });

  it("external-editor names — a copy of KNOWN_EDITORS inside a string", () => {
    const texts = drifted("programNames", (s) => {
      const decl = span(s, "pub(super) const KNOWN_EDITORS", "];");
      return `const DOC: &str = r#"\n${decl}\n"#;\n${s.replace(/^ *"zed",\n/m, "")}`;
    });
    expect(findingsFor(texts, "external-editor names").join("\n")).toMatch(/`zed` is named as a known editor but is not in KNOWN_EDITORS/);
  });

  it("workspace.close refusal reasons — a commented copy of handleWorkspaceClose", () => {
    const texts = drifted("workspaceBridge", (s) => {
      const fn = span(s, "export async function handleWorkspaceClose", "\n}\n");
      return `${lineCommented(fn)}\n${once(s, '{ closed: false, reason: "PINNED" }', '{ closed: false, reason: "LOCKED" }')}`;
    });
    expect(findingsFor(texts, "workspace.close refusal reasons").join("\n")).toMatch(/table has `PINNED`, handleWorkspaceClose does not/);
  });

  it("MCP tool count — a commented copy of TOOL_REGISTRY", () => {
    const texts = drifted("sidecarIndex", (s) => {
      const registry = span(s, "export const TOOL_REGISTRY = [", "\n] as const;");
      return `/*\n${registry}\n*/\n${once(s, "    name: SESSION_TOOL,\n", "")}`;
    });
    expect(findingsFor(texts, "MCP tool count").join("\n")).toMatch(/the guide says 10, the code says 9/);
  });

  it("menu readiness budget — the quoted log line only in a comment", () => {
    const texts = drifted("windowReady", (s) => `// menu commands did not mount within \${MENU_COMMANDS_BUDGET_MS}ms\n${s.replace("menu commands did not mount within", "menu commands timed out after")}`);
    expect(findingsFor(texts, "menu readiness budget")).toEqual([expect.stringMatching(/useWindowReady.ts readiness log line not found/)]);
  });
});

describe("codeView, captureCode and arrayStrings read code, not comments or unrelated literals", () => {
  it("captureCode skips a match that starts in a comment or a literal, and takes the first in code", () => {
    const src = '// const N = 1\nconst s = "const N = 2";\n/* const N = 3 */\nconst N = 4;\n';
    expect(captureCode(codeView(src, "x.ts"), /const N = (\d+)/, "N")).toBe("4");
    expect(captureCode(codeView(src.replace("const N = 4;", "const M = 4;"), "x.ts"), /const N = (\d+)/, "N", { inLiteral: true })).toBe("2");
    expect(() => captureCode(codeView(src.replace("const N = 4;", ""), "x.ts"), /const N = (\d+)/, "N")).toThrow(/N not found/);
  });

  it("captureCode keeps a value captured from a literal that the match opens in code", () => {
    expect(captureCode(codeView('const URL = "https://a.example";\n', "x.ts"), /URL\s*=\s*"([^"]+)"/, "URL")).toBe("https://a.example");
  });

  it("captureCode on Rust: nested block comments, raw strings and char literals", () => {
    const src = '/* outer /* const N: u8 = 1; */ still comment const N: u8 = 2; */\nconst Q: char = \'"\';\nconst S: &str = r#"const N: u8 = 3;"#;\nconst N: u8 = 4;\n';
    expect(captureCode(codeView(src, "x.rs"), /const N: u8 = (\d+)/, "N")).toBe("4");
  });

  it("captureCode with inLiteral finds a match only inside a literal", () => {
    const src = "// log: did not mount within 5ms\nlog(`did not mount within ${BUDGET}ms`);\n";
    expect(captureCode(codeView(src, "x.ts"), /(did not mount within \$\{BUDGET\}ms)/, "log", { inLiteral: true })).toBe("did not mount within ${BUDGET}ms");
    expect(() => captureCode(codeView(src.replace("log(`did", "log(`never"), "x.ts"), /(did not mount within \$\{BUDGET\}ms)/, "log", { inLiteral: true })).toThrow(/log not found/);
  });

  it("arrayStrings skips a declaration in a comment or a string", () => {
    const src = '// const NAMES: &[&str] = &["old"];\nconst DOC: &str = "const NAMES: &[&str] = &[\\"str\\"];";\npub const NAMES: &[&str] = &["a", "b"];\n';
    expect(arrayStrings(codeView(src, "x.rs"), "NAMES")).toEqual(["a", "b"]);
    const ts = '/* export const NAMES = ["old"]; */\nconst d = "const NAMES = [\\"s\\"]";\nexport const NAMES = ["a"] as const;\n';
    expect(arrayStrings(codeView(ts, "x.ts"), "NAMES")).toEqual(["a"]);
  });

  it("arrayStrings with only a commented declaration finds none", () => {
    expect(() => arrayStrings(codeView('// const NAMES = ["a"];\n', "x.ts"), "NAMES")).toThrow(/no `const NAMES` declaration/);
  });

  it("codeView keeps offsets and line numbers: comments are blanked to spaces, newlines kept", () => {
    const src = "a // 中文\n/* x\ny */ b\n";
    const view = codeView(src, "x.ts");
    expect(view.text).toHaveLength(src.length);
    expect(view.text.split("\n")).toHaveLength(src.split("\n").length);
    expect(view.text.trim().replace(/\s+/g, " ")).toBe("a b");
  });

  it("codeView of an empty file is empty", () => {
    expect(codeView("", "x.rs")).toMatchObject({ text: "" });
    expect(codeView("", "x.ts")).toMatchObject({ text: "" });
  });
});
