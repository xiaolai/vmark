// Phase 2 — workspace index, wiki resolution, graph, backlinks, walk rules.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildIndex } from "./buildIndex";
import { walkWorkspace } from "./walk";

let root: string;

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vmark-kb-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("walkWorkspace — deterministic rules", () => {
  it("skips excluded + always-skip dirs, hidden files, non-markdown", async () => {
    await write("a.md", "a");
    await write("node_modules/pkg/b.md", "b");
    await write(".git/c.md", "c");
    await write(".secret.md", "hidden");
    await write("notes/d.md", "d");
    await write("image.png", "binary");
    const { docs } = await walkWorkspace(root);
    const rels = docs.map((d) => d.relPath).sort();
    expect(rels).toEqual(["a.md", "notes/d.md"]);
  });

  it("includes hidden when requested", async () => {
    await write(".secret.md", "hidden");
    const { docs } = await walkWorkspace(root, { includeHidden: true });
    expect(docs.map((d) => d.relPath)).toContain(".secret.md");
  });

  it("honors .gitignore (root patterns, default on) — WI-2.1", async () => {
    await write(".gitignore", "drafts/\nignored.md\n");
    await write("keep.md", "k");
    await write("ignored.md", "x");
    await write("drafts/wip.md", "w");
    const rels = (await walkWorkspace(root)).docs.map((d) => d.relPath).sort();
    expect(rels).toEqual(["keep.md"]);
  });

  it("honors nested .gitignore scoped to its own subtree", async () => {
    await write("sub/.gitignore", "local.md\n");
    await write("sub/local.md", "x"); // ignored by sub/.gitignore
    await write("local.md", "k"); // NOT ignored (different scope)
    await write("sub/keep.md", "k");
    const rels = (await walkWorkspace(root)).docs.map((d) => d.relPath).sort();
    expect(rels).toEqual(["local.md", "sub/keep.md"]);
  });

  it("respects a nested .gitignore negation (!) re-including a parent-ignored file", async () => {
    await write(".gitignore", "*.draft.md\n");
    await write("sub/.gitignore", "!keep.draft.md\n");
    await write("a.draft.md", "ignored by root");
    await write("sub/other.draft.md", "ignored by root pattern");
    await write("sub/keep.draft.md", "re-included by the nested negation");
    const rels = (await walkWorkspace(root)).docs.map((d) => d.relPath).sort();
    expect(rels).toEqual(["sub/keep.draft.md"]);
  });

  it("can disable .gitignore honoring via respectGitignore:false", async () => {
    await write(".gitignore", "ignored.md\n");
    await write("ignored.md", "x");
    const rels = (await walkWorkspace(root, { respectGitignore: false })).docs.map(
      (d) => d.relPath
    );
    expect(rels).toContain("ignored.md");
  });

  it("reports truncation at maxFiles", async () => {
    await write("a.md", "1");
    await write("b.md", "2");
    await write("c.md", "3");
    const { docs, truncated } = await walkWorkspace(root, { maxFiles: 2 });
    expect(docs.length).toBe(2);
    expect(truncated).toBe(true);
  });

  it("NFC-normalizes basenames (CJK/diacritics)", async () => {
    // U+00E9 vs e + combining acute — must normalize to the same basename
    await write("café.md", "x");
    const { docs } = await walkWorkspace(root);
    expect(docs[0].basename).toBe("café".normalize("NFC"));
  });
});

describe("buildIndex — wiki-link resolution (§3bis spec)", () => {
  it("resolves [[Page]] by basename", async () => {
    await write("Home.md", "[[Page One]]");
    await write("Page One.md", "content");
    const idx = await buildIndex(root);
    const r = idx.resolver.resolve("Page One", "Home.md");
    expect(r.relPath).toBe("Page One.md");
  });

  it("resolves [[dir/Page]] by relpath", async () => {
    await write("Home.md", "[[notes/Deep]]");
    await write("notes/Deep.md", "content");
    const idx = await buildIndex(root);
    expect(idx.resolver.resolve("notes/Deep", "Home.md").relPath).toBe("notes/Deep.md");
  });

  it("splits the #anchor", async () => {
    await write("Page.md", "x");
    const idx = await buildIndex(root);
    const r = idx.resolver.resolve("Page#Section", "x.md");
    expect(r.relPath).toBe("Page.md");
    expect(r.anchor).toBe("Section");
  });

  it("matches case-insensitively", async () => {
    await write("MyPage.md", "x");
    const idx = await buildIndex(root);
    expect(idx.resolver.resolve("mypage", "x.md").relPath).toBe("MyPage.md");
  });

  it("prefers same-directory match on duplicate basenames", async () => {
    await write("a/Dup.md", "in a");
    await write("b/Dup.md", "in b");
    await write("b/Src.md", "[[Dup]]");
    const idx = await buildIndex(root);
    expect(idx.resolver.resolve("Dup", "b/Src.md").relPath).toBe("b/Dup.md");
  });

  it("returns null for missing targets", async () => {
    await write("Home.md", "[[Nope]]");
    const idx = await buildIndex(root);
    expect(idx.resolver.resolve("Nope", "Home.md").relPath).toBeNull();
  });
});

describe("buildIndex — relationship graph + backlinks", () => {
  it("builds resolved wiki edges and backlinks", async () => {
    await write("A.md", "[[B]]");
    await write("B.md", "content");
    const idx = await buildIndex(root);
    const edge = idx.graph.edges.find((e) => e.kind === "wikiLink");
    expect(edge).toMatchObject({ from: "A.md", to: "B.md", kind: "wikiLink" });
    expect(idx.backlinks("B.md")).toEqual(["A.md"]);
  });

  it("marks unresolved wiki targets but still creates a node", async () => {
    await write("A.md", "[[Ghost]]");
    const idx = await buildIndex(root);
    const edge = idx.graph.edges.find((e) => e.kind === "wikiLink");
    expect(edge?.unresolved).toBe(true);
    expect(idx.graph.nodes.some((n) => n.unresolved && n.id === "[[Ghost]]")).toBe(true);
    expect(idx.backlinks("[[Ghost]]")).toEqual([]); // unresolved excluded from backlinks
  });

  it("extracts inline #tags and frontmatter tags into tag nodes", async () => {
    await write("A.md", "---\ntags: [project]\n---\n\nbody #idea and #idea again");
    const idx = await buildIndex(root);
    const tagNodes = idx.graph.nodes.filter((n) => n.type === "tag").map((n) => n.id).sort();
    expect(tagNodes).toEqual(["#idea", "#project"]);
    const tagEdges = idx.graph.edges.filter((e) => e.kind === "tag");
    expect(tagEdges.length).toBe(2); // deduped #idea
  });

  it("builds typed relation edges from frontmatter", async () => {
    await write("Child.md", "---\nup: Parent\nrelated:\n  - Sibling\n---\n");
    await write("Parent.md", "p");
    await write("Sibling.md", "s");
    const idx = await buildIndex(root);
    const up = idx.graph.edges.find((e) => e.relationKey === "up");
    expect(up).toMatchObject({ from: "Child.md", to: "Parent.md", kind: "relation" });
    const related = idx.graph.edges.find((e) => e.relationKey === "related");
    expect(related?.to).toBe("Sibling.md");
  });

  it("resolves relative markdown links into link edges", async () => {
    await write("notes/A.md", "[see](../top.md) and [b](./B.md)");
    await write("top.md", "t");
    await write("notes/B.md", "b");
    const idx = await buildIndex(root);
    const targets = idx.graph.edges.filter((e) => e.kind === "link").map((e) => e.to).sort();
    expect(targets).toEqual(["notes/B.md", "top.md"]);
  });

  it("uses frontmatter title on the doc node", async () => {
    await write("A.md", "---\ntitle: My Title\n---\n\nbody");
    const idx = await buildIndex(root);
    expect(idx.graph.nodes.find((n) => n.id === "A.md")?.title).toBe("My Title");
  });
});
