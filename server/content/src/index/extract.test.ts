// M13 — direct tests for reference extraction (links, tags, relations, frontmatter).
import { describe, it, expect } from "vitest";
import { extractRefs } from "./extract";

describe("extractRefs", () => {
  it("extracts wiki targets (alias stripped)", () => {
    expect(extractRefs("[[Page|Alias]] and [[Other]]").wikiTargets).toEqual(["Page", "Other"]);
  });

  it("keeps only local markdown links (drops external/fragment/protocol-relative)", () => {
    const r = extractRefs(
      "[a](./x.md) [b](https://e.com) [c](#frag) [d](//cdn) [e](../y.md) [f](mailto:x@y.z)"
    );
    expect(r.localLinks.sort()).toEqual(["../y.md", "./x.md"]);
  });

  it("extracts inline #tags (deduped, NFC-lowercased) and frontmatter tags", () => {
    const r = extractRefs("---\ntags: [Project]\n---\n\n#idea and #idea and #Café");
    expect(r.tags).toEqual(["café", "idea", "project"]);
  });

  it("extracts typed relations and title from frontmatter", () => {
    const r = extractRefs("---\ntitle: T\nup: Parent\nrelated:\n  - A\n  - B\n---\n");
    expect(r.title).toBe("T");
    expect(r.relations.up).toEqual(["Parent"]);
    expect(r.relations.related).toEqual(["A", "B"]);
  });

  it("survives malformed YAML frontmatter — body still indexes (M8)", () => {
    const r = extractRefs("---\n: : bad : :\n---\n\nbody #kept");
    expect(r.title).toBeUndefined();
    expect(r.relations).toEqual({});
    expect(r.tags).toEqual(["kept"]);
  });

  it("coerces scalar/number frontmatter relation values to strings", () => {
    const r = extractRefs("---\nlinks: 42\n---\n");
    expect(r.relations.links).toEqual(["42"]);
  });
});
