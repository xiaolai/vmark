// WI-RA15C.10 — the guide's checkable claims stay joined to the code.
// WI-AL1.7 — the session label's variable name and byte limit in mcp-setup.md.
//
// Every claim is exercised against the real tree (clean) and against a copy
// of the tree with one side changed (a finding naming the claim). A pattern
// that stops matching is a finding too, never a pass.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../../check-doc-joins.mjs";
import { checkClaims, run, id, DEFAULT_PATHS } from "./guideClaims.mjs";
import { CLAIMS, CLAIM_PATHS, arrayStrings, capture, durationMs, numberFromWord, spansAfter } from "./guideClaimsTable.mjs";
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

describe("guide-claims against the real tree", () => {
  it("is clean, and checks every claim in the table", async () => {
    const { findings, info } = await run({ root: ROOT, paths: DEFAULT_PATHS });
    expect(findings).toEqual([]);
    expect(info).toEqual([`${CLAIMS.length} claims checked`]);
    expect(id).toBe("guide-claims");
  });

  it("every claim reads only declared paths", () => {
    for (const claim of CLAIMS) for (const key of claim.files) expect(Object.keys(CLAIM_PATHS)).toContain(key);
  });
});

describe("each claim fails when one side drifts", () => {
  const cases = [
    ["browser start page", "browserCommands", (s) => s.replace('NEW_BROWSER_TAB_URL = "https://duckduckgo.com"', 'NEW_BROWSER_TAB_URL = "https://example.org"'), /the guide says https:\/\/duckduckgo.com, the code says https:\/\/example.org/],
    ["browser search engine", "omnibox", (s) => s.replace(/SEARCH_URL_BASE\s*=\s*"[^"]+"/, 'SEARCH_URL_BASE = "https://www.google.com/search"'), /names duckduckgo, SEARCH_URL_BASE searches www.google.com/],
    ["MCP client credential key", "tokenField", (s) => s.replace('TOKEN_ENV_KEY: &str = "VMARK_MCP_TOKEN"', 'TOKEN_ENV_KEY: &str = "VMARK_TOKEN"'), /does not name `env.VMARK_TOKEN`/],
    ["IME grace period", "imeGuard", (s) => s.replace("IME_GRACE_PERIOD_MS = 50", "IME_GRACE_PERIOD_MS = 80"), /the guide says 50, the code says 80/],
    ["menu readiness budget", "windowReady", (s) => s.replace("MENU_COMMANDS_BUDGET_MS = 5_000", "MENU_COMMANDS_BUDGET_MS = 8_000"), /the guide says 5000, the code says 8000/],
    ["nesting limit", "largeFilesGuide", (s) => s.replace("nested more than 1000 levels deep", "nested more than 500 levels deep"), /large-files.md limit: the guide says 500, the code says 1000/],
    ["prompt history size", "promptHistory", (s) => s.replace("const MAX_ENTRIES = 100", "const MAX_ENTRIES = 50"), /the guide says 100, the code says 50/],
    ["terminal hangup grace", "ptyChild", (s) => s.replace("Duration::from_millis(1000)", "Duration::from_millis(2500)"), /the guide says 1000, the code says 2500/],
    ["confirm-quit window", "quit", (s) => s.replace("Duration::from_secs(2)", "Duration::from_secs(3)"), /the guide says 2, the code says 3/],
    ["workspace.close refusal reasons", "workspaceBridge", (s) => s.replace('{ closed: false, reason: "PINNED" }', '{ closed: false, reason: "LOCKED" }'), /table has `PINNED`, handleWorkspaceClose does not/],
    ["sort lines are Source-only", "textActions", (s) => s.replace(/(sortLinesAsc: \{[^}]*?supports: \{ wysiwyg: )false/, "$1true"), /F4 row says Source mode only; sortLinesAsc supports WYSIWYG: true/],
    ["OS file associations", "tauriConf", (s) => s.replace('"ext": ["toml"]', '"ext": ["toml", "ini"]'), /tauri.conf.json has `.toml, .ini = TOML Document`/],
    ["external-editor names", "programNames", (s) => s.replace(/^ *"zed",\n/m, ""), /`zed` is named as a known editor but is not in KNOWN_EDITORS/],
    ["MCP tool count", "mcpToolsGuide", (s) => s.replace("exposes **ten composite MCP tools**", "exposes **nine composite MCP tools**"), /the guide says 9, the code says 10/],
    ["MCP session label", "sessionLabel", (s) => s.replace("MAX_SESSION_LABEL_BYTES = 128", "MAX_SESSION_LABEL_BYTES = 64"), /label bytes: the guide says 128, the code says 64/],
    ["Git export branch", "gitExportNames", (s) => s.replace('format!("vmark-journal/{doc}")', 'format!("vmark-history/{doc}")'), /branch prefix: the guide says vmark-journal\/, the code says vmark-history\//],
    ["Git export trailers", "gitExportPlan", (s) => s.replace('("VMark-Tool", tool)', '("VMark-Agent", tool)'), /trailer table has `VMark-Tool`, plan.rs does not/],
    ["block-density threshold", "fileSizeThresholds", (s) => s.replace("SOURCE_MODE_DEFAULT_BLOCKS: 1200", "SOURCE_MODE_DEFAULT_BLOCKS: 900"), /block-density threshold \(blocks\): the guide says 1200, the code says 900/],
  ];

  it("the session label claim also fails when the variable is renamed", () => {
    const texts = drifted("sessionLabel", (s) => s.replace("SESSION_LABEL_ENV = 'VMARK_SESSION_LABEL'", "SESSION_LABEL_ENV = 'VMARK_LABEL'"));
    expect(findingsFor(texts, "MCP session label").join("\n")).toMatch(/does not name `VMARK_LABEL`/);
  });

  it("covers every claim in the table", () => {
    expect(cases.map(([name]) => name).sort()).toEqual(CLAIMS.map((c) => c.name).sort());
  });

  it.each(cases)("%s", (name, key, edit, expected) => {
    const findings = findingsFor(drifted(key, edit), name);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.join("\n")).toMatch(expected);
  });
});

describe("the Git trailer claim reads plan.rs's production code only", () => {
  it("a trailer whose push is commented out is gone, though the comment still names it", () => {
    const texts = drifted("gitExportPlan", (s) => s.replace('out.push(("VMark-Tool", tool));', '// out.push(("VMark-Tool", tool));'));
    expect(findingsFor(texts, "Git export trailers").join("\n")).toMatch(/trailer table has `VMark-Tool`, plan.rs does not/);
  });

  it("a trailer tuple in a test module or a doc comment is not an emitted trailer", () => {
    const texts = drifted("gitExportPlan", (s) =>
      `${s.replace('out.push(("VMark-Tool", tool));', "")}\n/// e.g. ("VMark-Tool", tool)\n#[cfg(test)]\nmod t {\n    const X: (&str, &str) = ("VMark-Tool", "x");\n}\n`);
    expect(findingsFor(texts, "Git export trailers").join("\n")).toMatch(/trailer table has `VMark-Tool`, plan.rs does not/);
  });

  it("a trailer-shaped tuple in an unrelated production function does not mask removal from the builders", () => {
    const texts = drifted("gitExportPlan", (s) =>
      `${s.replace('out.push(("VMark-Tool", tool));', "")}\nfn unrelated() -> (&'static str, &'static str) {\n    ("VMark-Tool", "x")\n}\n`);
    expect(findingsFor(texts, "Git export trailers").join("\n")).toMatch(/trailer table has `VMark-Tool`, plan.rs does not/);
  });

  it("a builder no commit construction calls any more is not an emitted trailer", () => {
    const texts = drifted("gitExportPlan", (s) => s.replace("trailers.extend(agent_trailers(link));", ""));
    const found = findingsFor(texts, "Git export trailers").join("\n");
    expect(found).toMatch(/agent_trailers is not reachable from plan/);
    expect(found).toMatch(/trailer table has `VMark-Tool`, plan.rs does not/);
  });

  it("a builder reached only through a helper the plan calls still counts", () => {
    const texts = drifted("gitExportPlan", (s) => s
      .replace("trailers.extend(agent_trailers(link));", "trailers.extend(optional(link));")
      .replace("fn message(", "fn optional(link: &ChainLink) -> Vec<(&'static str, String)> {\n    agent_trailers(link)\n}\n\nfn message("));
    expect(findingsFor(texts, "Git export trailers")).toEqual([]);
  });

  it("a builder that is renamed away is a finding, never a silent empty list", () => {
    const texts = drifted("gitExportPlan", (s) => s.replace("fn agent_trailers(", "fn optional_trailers(").replace("agent_trailers(link)", "optional_trailers(link)"));
    expect(findingsFor(texts, "Git export trailers").join("\n")).toMatch(/agent_trailers/);
  });
});

describe("a pattern that stops matching is a finding", () => {
  it("a reworded guide sentence", () => {
    const findings = findingsFor(drifted("featuresGuide", (s) => s.replace("for 50 ms after the composition ends", "briefly after composing")), "IME grace period");
    expect(findings).toEqual([expect.stringMatching(/features.md IME sentence not found/)]);
  });

  it("a reworded log line the guide quotes", () => {
    const findings = findingsFor(drifted("windowReady", (s) => s.replace("menu commands did not mount within", "menu commands timed out after")), "menu readiness budget");
    expect(findings).toEqual([expect.stringMatching(/useWindowReady.ts readiness log line not found/)]);
  });

  it("a renamed constant", () => {
    const findings = findingsFor(drifted("ptyChild", (s) => s.replace("HANGUP_GRACE:", "HUP_GRACE:")), "terminal hangup grace");
    expect(findings).toEqual([expect.stringMatching(/HANGUP_GRACE not found/)]);
  });

  it("a missing file text", () => {
    const texts = realTexts();
    delete texts.quit;
    expect(findingsFor(texts, "confirm-quit window")).toEqual(["confirm-quit window: no text for quit"]);
  });
});

describe("helpers", () => {
  it("capture throws naming what it looked for", () => {
    expect(() => capture("abc", /x(\d)/, "the x")).toThrow(/the x not found/);
    expect(capture("x7", /x(\d)/, "the x")).toBe("7");
  });

  it("numberFromWord reads digits and the small number words, and refuses the rest", () => {
    expect(numberFromWord("two")).toBe(2);
    expect(numberFromWord("Nine")).toBe(9);
    expect(numberFromWord("12")).toBe(12);
    expect(() => numberFromWord("several")).toThrow(/not a number word/);
  });

  it("durationMs reads the guide's phrasings", () => {
    expect(durationMs("a second")).toBe(1000);
    expect(durationMs("2 seconds")).toBe(2000);
    expect(durationMs("two seconds")).toBe(2000);
    expect(durationMs("500 ms")).toBe(500);
    expect(() => durationMs("a while")).toThrow(/not a duration/);
  });

  it("arrayStrings reads the declared array, not an earlier mention, and skips comments", () => {
    const src = '/// see [`NAMES`]\nconst OTHER: &[&str] = &["x"];\npub const NAMES: &[&str] = &[\n  // "commented"\n  "a", "b",\n];\n';
    expect(arrayStrings(codeView(src, "x.rs"), "NAMES")).toEqual(["a", "b"]);
    expect(() => arrayStrings(codeView(src, "x.rs"), "MISSING")).toThrow(/no `const MISSING` declaration/);
  });

  it("arrayStrings reads literals whole: a comment marker, an escaped quote or `];` inside a string is content", () => {
    const src = 'const NAMES: &[&str] = &[\n  "http://host", "say \\"hi\\"", "a // b", "x];y", /* "gone" */ "back\\\\slash",\n];\n';
    expect(arrayStrings(codeView(src, "x.rs"), "NAMES")).toEqual(["http://host", 'say "hi"', "a // b", "x];y", "back\\slash"]);
  });

  it("arrayStrings reads an empty array and a TS array closed by ] without a semicolon", () => {
    expect(arrayStrings(codeView("const NAMES: &[&str] = &[];\n", "x.rs"), "NAMES")).toEqual([]);
    expect(arrayStrings(codeView('export const NAMES = ["a", "中文"] as const\n', "x.ts"), "NAMES")).toEqual(["a", "中文"]);
  });

  it.each([
    ["an unterminated array", 'const NAMES = ["a", "b"\n', /NAMES: unterminated array literal/],
    ["an unterminated string", 'const NAMES = ["a];\n', /NAMES: unterminated array literal/],
    ["a single-quoted literal it cannot read as a string", "const NAMES = ['a'];\n", /NAMES: unsupported literal/],
    ["a template literal", "const NAMES = [`a`];\n", /NAMES: unsupported literal/],
  ])("arrayStrings refuses %s instead of dropping it", (_name, src, error) => {
    expect(() => arrayStrings(codeView(src, "x.ts"), "NAMES")).toThrow(error);
  });

  it("spansAfter refuses a parenthesis that never closes, rather than reading to the end", () => {
    expect(() => spansAfter("a shell (`sh`, `bash`", "a shell (", "the list")).toThrow(/the list: no closing parenthesis/);
  });

  it("spansAfter reads the code spans of one parenthesis", () => {
    expect(spansAfter("a shell (`sh`, `bash`, …), an interpreter (`python`)", "a shell (", "x")).toEqual(["sh", "bash"]);
    expect(() => spansAfter("nothing", "a shell (", "the list")).toThrow(/the list not found/);
  });
});
