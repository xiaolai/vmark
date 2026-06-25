// M13 — direct tests for workspace search (caps, truncation, case sensitivity).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { searchWorkspace, SEARCH_CAPS } from "./search";
import type { DocEntry } from "../index/types";

let root: string;
function doc(rel: string): DocEntry {
  return { absPath: path.join(root, rel), relPath: rel, basename: rel.replace(/\.md$/, "") };
}
async function write(rel: string, content: string) {
  await fs.writeFile(path.join(root, rel), content, "utf8");
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vmark-search-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("searchWorkspace", () => {
  it("returns nothing for an empty query", async () => {
    await write("a.md", "x");
    expect(await searchWorkspace([doc("a.md")], "")).toEqual([]);
  });

  it("is case-insensitive by default, case-sensitive on request", async () => {
    await write("a.md", "Hello World");
    expect((await searchWorkspace([doc("a.md")], "hello")).length).toBe(1);
    expect((await searchWorkspace([doc("a.md")], "hello", { caseSensitive: true })).length).toBe(0);
  });

  it("reports line numbers and skips unreadable files", async () => {
    await write("a.md", "one\ntwo match\nthree");
    const res = await searchWorkspace([doc("a.md"), doc("missing.md")], "match");
    expect(res.length).toBe(1);
    expect(res[0].matches[0].lineNumber).toBe(2);
  });

  it("truncates long matching lines with ellipsis", async () => {
    const long = "x".repeat(50) + "needle" + "y".repeat(300);
    await write("a.md", long);
    const res = await searchWorkspace([doc("a.md")], "needle");
    const line = res[0].matches[0].lineContent;
    expect(line.length).toBeLessThanOrEqual(SEARCH_CAPS.maxLineLen + 2);
    expect(line).toContain("…");
  });

  it("caps the number of files returned", async () => {
    const docs: DocEntry[] = [];
    for (let i = 0; i < SEARCH_CAPS.maxFiles + 5; i++) {
      await write(`f${i}.md`, "hit");
      docs.push(doc(`f${i}.md`));
    }
    const res = await searchWorkspace(docs, "hit");
    expect(res.length).toBeLessThanOrEqual(SEARCH_CAPS.maxFiles);
  });
});
