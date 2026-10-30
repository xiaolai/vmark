// WI-RA15C.10 — every translated guide page keeps its English page's structure.
//
// Synthetic site trees in a temp directory, so each kind of drift is shown
// failing; the real tree is checked by check-doc-joins.test.mjs ("the gate is
// clean").

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_PATHS, compareShapes, id, localeCodes, pageShape, run } from "./localeStructure.mjs";
import { ROOT } from "../../check-doc-joins.mjs";

const PAGE = [
  "# Title",
  "",
  "## Section",
  "",
  "| A | B |",
  "|---|---|",
  "| 1 | 2 |",
  "",
  "::: tip",
  "Hint",
  ":::",
  "",
  "```mermaid",
  "flowchart TD",
  "  A --> B",
  "```",
  "",
  "### Sub",
  "",
  "```ts",
  "# not a heading",
  "| not | a table |",
  "|---|---|",
  "```",
].join("\n");

let dirs = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function site(files) {
  const root = mkdtempSync(join(tmpdir(), "locale-structure-"));
  dirs.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

const runOn = (files) => run({ root: site(files), paths: { website: "website" } });

describe("pageShape", () => {
  it("counts headings by level, tables, fences, mermaid and containers, and ignores fenced content", () => {
    expect(pageShape(PAGE)).toEqual({ headings: [1, 2, 3], tables: 1, tableRows: [1], fences: 2, mermaid: 1, containers: 1 });
  });

  it("treats a longer fence that shows a shorter one as one opaque block", () => {
    const nested = ["# T", "````markdown", "```mermaid", "flowchart TD", "```", "## not a heading", "````", "## H"].join("\n");
    expect(pageShape(nested)).toEqual({ headings: [1, 2], tables: 0, tableRows: [], fences: 1, mermaid: 0, containers: 0 });
  });

  it("reads CRLF pages the same", () => {
    expect(pageShape(PAGE.replaceAll("\n", "\r\n"))).toEqual(pageShape(PAGE));
  });

  it("is empty for an empty page", () => {
    expect(pageShape("")).toEqual({ headings: [], tables: 0, tableRows: [], fences: 0, mermaid: 0, containers: 0 });
  });
});

describe("compareShapes", () => {
  const en = pageShape(PAGE);

  it("matches an identical structure with translated text", () => {
    const ja = PAGE.replace("# Title", "# タイトル").replace("Hint", "ヒント");
    expect(compareShapes(en, pageShape(ja))).toEqual([]);
  });

  it("names a missing heading and where the first difference is", () => {
    const local = pageShape(PAGE.replace("## Section\n", ""));
    expect(compareShapes(en, local)).toEqual(["2 headings, English 3; first difference at heading 2 (level 3, English 2)"]);
  });

  it("names a heading at the wrong level", () => {
    expect(compareShapes(en, pageShape(PAGE.replace("### Sub", "## Sub")))).toEqual([
      "3 headings, English 3; first difference at heading 3 (level 2, English 3)",
    ]);
  });

  it("names a table that gained or lost a row, by its position", () => {
    // A row English added (a new setting, a new image rule) is as much a
    // missing piece of the page as a missing table.
    const twoTables = `${PAGE}\n\n| X |\n|---|\n| a |\n| b |\n`;
    const dropped = twoTables.replace("| b |\n", "");
    expect(compareShapes(pageShape(twoTables), pageShape(dropped))).toEqual(["table 2 has 1 rows, English 2"]);
    expect(compareShapes(pageShape(twoTables), pageShape(twoTables.replace("| 1 | 2 |", "| 1 | 2 |\n| 3 | 4 |")))).toEqual([
      "table 1 has 2 rows, English 1",
    ]);
  });

  it("ends a table at its first non-row line", () => {
    expect(pageShape("| A |\n|---|\n| 1 |\n\nText | with a pipe\n").tableRows).toEqual([1]);
  });

  it("names every count that differs", () => {
    const local = pageShape(PAGE.replace("::: tip", "Tip:").replace("```mermaid", "```text"));
    expect(compareShapes(en, local)).toEqual(["0 mermaid, English 1", "0 containers, English 1"]);
  });
});

describe("run", () => {
  it("is clean on the real site, read through its DEFAULT_PATHS", async () => {
    const { findings, info } = await run({ root: ROOT, paths: DEFAULT_PATHS });
    expect(findings).toEqual([]);
    expect(info[0]).toMatch(/^\d+ pages × 9 locales \(de, es, fr, it, ja, ko, pt-BR, zh-CN, zh-TW\)$/);
    expect(id).toBe("locale-structure");
  });

  it("is clean when every locale matches", async () => {
    const { findings, info } = await runOn({ "website/guide/a.md": PAGE, "website/ja/guide/a.md": PAGE, "website/de/guide/a.md": PAGE });
    expect(findings).toEqual([]);
    expect(info).toEqual(["1 pages × 2 locales (de, ja)"]);
  });

  it("reports a page missing from a locale, a drifted page, and an orphan", async () => {
    const { findings } = await runOn({
      "website/guide/a.md": PAGE,
      "website/guide/sub/b.md": "# B\n",
      "website/ja/guide/a.md": PAGE.replace("### Sub", "#### Sub"),
      "website/ja/guide/old.md": "# Old\n",
    });
    expect(findings).toEqual([
      "ja/guide/a.md: 3 headings, English 3; first difference at heading 3 (level 4, English 3)",
      "ja/guide/sub/b.md: missing (English has it)",
      "ja/guide/old.md: no English page (orphan)",
    ]);
  });

  it("fails closed when there is no locale at all", async () => {
    const { findings } = await runOn({ "website/guide/a.md": PAGE });
    expect(findings).toEqual(["no website/<locale>/guide/ directory found"]);
  });

  it("finds locales by their guide directory, not by name", () => {
    const root = site({ "website/guide/a.md": PAGE, "website/ko/guide/a.md": PAGE, "website/blog/x.md": "# x\n", "website/.vitepress/x.ts": "" });
    expect(localeCodes(root, "website")).toEqual(["ko"]);
  });
});
