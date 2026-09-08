// @vitest-environment node
// Audit R3 #607/#609/#621 — the picker's list arrangement, testable without
// rendering the overlay.
import { describe, expect, it } from "vitest";
import type { GenieDefinition, GenieScope } from "@/types/aiGenies";
import { buildGenieList, filterGenies, genieQuery, scopedRecents } from "./genieListDerivation";

function genie(name: string, opts: { category?: string; scope?: GenieScope } = {}): GenieDefinition {
  return {
    metadata: {
      name,
      description: `${name} does a thing`,
      scope: opts.scope ?? "selection",
      ...(opts.category === undefined ? {} : { category: opts.category }),
    },
    template: "",
    filePath: `/genies/${name}.md`,
    source: "global",
    kind: "markdown",
  } as unknown as GenieDefinition;
}

describe("genieQuery", () => {
  it.each(["", "   ", "\t\n "])("treats %o as no query at all", (raw) => {
    expect(genieQuery(raw)).toBe("");
  });

  it("trims a real query, so search and submission agree on it", () => {
    expect(genieQuery("  translate  ")).toBe("translate");
  });
});

describe("scopedRecents", () => {
  const recents = [genie("A"), genie("B", { scope: "document" })];

  it("shows nothing while a query is active — the results are the answer", () => {
    expect(scopedRecents(recents, null, "translate")).toEqual([]);
  });

  it("shows every recent when no scope is pinned", () => {
    expect(scopedRecents(recents, null, "").map((g) => g.metadata.name)).toEqual(["A", "B"]);
  });

  it("keeps only the recents matching the pinned scope", () => {
    expect(scopedRecents(recents, "document", "").map((g) => g.metadata.name)).toEqual(["B"]);
  });

  it("still shows recents for a whitespace-only query", () => {
    // The picker used to treat "   " as a search: recents vanished and every
    // genie was filtered out, leaving a freeform hint whose Enter did nothing.
    expect(scopedRecents(recents, null, genieQuery("   "))).toHaveLength(2);
  });
});

describe("buildGenieList", () => {
  it("groups by category in encounter order", () => {
    const list = buildGenieList(
      [genie("A", { category: "Write" }), genie("B", { category: "Edit" }), genie("C", { category: "Write" })],
      [],
      "Uncategorised",
    );
    expect([...list.grouped.keys()]).toEqual(["Write", "Edit"]);
    expect(list.grouped.get("Write")?.map((g) => g.metadata.name)).toEqual(["A", "C"]);
  });

  it("files a genie with no category under the CALLER'S label (#609)", () => {
    const list = buildGenieList([genie("A")], [], "未分类");
    expect([...list.grouped.keys()]).toEqual(["未分类"]);
  });

  it("does not repeat a genie that already has a recents row above it", () => {
    const recent = genie("A", { category: "Write" });
    const list = buildGenieList([recent, genie("B", { category: "Write" })], [recent], "Other");
    expect(list.grouped.get("Write")?.map((g) => g.metadata.name)).toEqual(["B"]);
    expect(list.flat.map((g) => g.metadata.name)).toEqual(["A", "B"]);
  });

  it("keeps a match visible when there is no recents section to hold it", () => {
    const list = buildGenieList([genie("A", { category: "Write" })], [], "Other");
    expect(list.flat.map((g) => g.metadata.name)).toEqual(["A"]);
  });

  it("flattens recents first, then every group, in render order", () => {
    const list = buildGenieList(
      [genie("B", { category: "Edit" }), genie("C", { category: "Write" })],
      [genie("A")],
      "Other",
    );
    expect(list.flat.map((g) => g.metadata.name)).toEqual(["A", "B", "C"]);
  });

  it("returns an empty list for no matches and no recents", () => {
    const list = buildGenieList([], [], "Other");
    expect(list.flat).toEqual([]);
    expect(list.grouped.size).toBe(0);
  });
});

// Audit R3 #607 — the picker's match rule and the genies store's `searchGenies`
// are the same rule. They were written out twice, in files that import each
// other, and nothing held them together. This does.
describe("filterGenies agrees with the store's searchGenies", () => {
  const catalogue = [
    genie("Translate", { category: "Writing", scope: "selection" }),
    genie("Summarise", { category: "Writing", scope: "document" }),
    genie("Explain", { scope: "block" }),
  ];

  it.each([
    ["", null],
    ["tr", null],
    ["TRANSLATE", null],
    ["writing", null],
    ["does a thing", null],
    ["nothing matches this", null],
    ["", "document"],
    ["writing", "document"],
    ["explain", "block"],
    ["explain", "selection"],
  ] as const)("query %o, scope %o", async (query, scope) => {
    const { useGeniesStore } = await import("@/stores/aiStore/genies");
    useGeniesStore.setState({ genies: catalogue });
    expect(filterGenies(catalogue, query, scope).map((g) => g.metadata.name)).toEqual(
      useGeniesStore.getState().searchGenies(query, scope).map((g) => g.metadata.name),
    );
  });
});
