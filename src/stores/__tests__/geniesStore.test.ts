import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useGeniesStore } from "../aiStore";
import type { GenieDefinition } from "@/types/aiGenies";

function makeGenie(overrides: Partial<GenieDefinition> & { name: string }): GenieDefinition {
  return {
    metadata: {
      name: overrides.name,
      description: overrides.metadata?.description ?? `Description for ${overrides.name}`,
      scope: overrides.metadata?.scope ?? "selection",
      category: overrides.metadata?.category,
    },
    template: overrides.template ?? "template",
    filePath: overrides.filePath ?? `/genies/${overrides.name}.md`,
    source: "global",
  };
}

describe("geniesStore", () => {
  beforeEach(() => {
    useGeniesStore.setState({
      genies: [],
      loading: false,
      recentGenieNames: [],
      favoriteGenieNames: [],
    });
  });

  // ── Initialization ──────────────────────────────────────────────────

  it("initializes with empty genies", () => {
    const state = useGeniesStore.getState();
    expect(state.genies).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.recentGenieNames).toEqual([]);
    expect(state.favoriteGenieNames).toEqual([]);
  });

  // ── addRecent ───────────────────────────────────────────────────────

  it("adds a genie name to recents", () => {
    useGeniesStore.getState().addRecent("Translate");
    expect(useGeniesStore.getState().recentGenieNames).toEqual(["Translate"]);
  });

  it("moves duplicate to the top (MRU order)", () => {
    const { addRecent } = useGeniesStore.getState();
    addRecent("A");
    addRecent("B");
    addRecent("C");
    addRecent("A"); // re-add
    expect(useGeniesStore.getState().recentGenieNames).toEqual(["A", "C", "B"]);
  });

  it("caps recents at 10", () => {
    const { addRecent } = useGeniesStore.getState();
    for (let i = 0; i < 15; i++) {
      addRecent(`genie-${i}`);
    }
    const { recentGenieNames } = useGeniesStore.getState();
    expect(recentGenieNames).toHaveLength(10);
    expect(recentGenieNames[0]).toBe("genie-14");
    expect(recentGenieNames).not.toContain("genie-0");
  });

  // ── toggleFavorite / isFavorite ─────────────────────────────────────

  it("toggles favorite on", () => {
    useGeniesStore.getState().toggleFavorite("Summarize");
    expect(useGeniesStore.getState().favoriteGenieNames).toEqual(["Summarize"]);
    expect(useGeniesStore.getState().isFavorite("Summarize")).toBe(true);
  });

  it("toggles favorite off", () => {
    useGeniesStore.getState().toggleFavorite("Summarize");
    useGeniesStore.getState().toggleFavorite("Summarize");
    expect(useGeniesStore.getState().favoriteGenieNames).toEqual([]);
    expect(useGeniesStore.getState().isFavorite("Summarize")).toBe(false);
  });

  it("isFavorite returns false for unknown name", () => {
    expect(useGeniesStore.getState().isFavorite("nonexistent")).toBe(false);
  });

  // ── searchGenies ────────────────────────────────────────────────────

  describe("searchGenies", () => {
    beforeEach(() => {
      useGeniesStore.setState({
        genies: [
          makeGenie({ name: "Translate", metadata: { name: "Translate", description: "Translate text", scope: "selection", category: "Language" } }),
          makeGenie({ name: "Summarize", metadata: { name: "Summarize", description: "Create summary", scope: "document", category: "Writing" } }),
          makeGenie({ name: "Fix Grammar", metadata: { name: "Fix Grammar", description: "Fix grammar issues", scope: "selection", category: "Language" } }),
        ],
      });
    });

    it("returns all genies when query is empty", () => {
      const result = useGeniesStore.getState().searchGenies("");
      expect(result).toHaveLength(3);
    });

    it("searches by name case-insensitively", () => {
      const result = useGeniesStore.getState().searchGenies("translate");
      expect(result).toHaveLength(1);
      expect(result[0].metadata.name).toBe("Translate");
    });

    it("searches by description", () => {
      const result = useGeniesStore.getState().searchGenies("summary");
      expect(result).toHaveLength(1);
      expect(result[0].metadata.name).toBe("Summarize");
    });

    it("searches by category", () => {
      const result = useGeniesStore.getState().searchGenies("language");
      expect(result).toHaveLength(2);
    });

    it("filters by scope", () => {
      const result = useGeniesStore.getState().searchGenies("", "document");
      expect(result).toHaveLength(1);
      expect(result[0].metadata.name).toBe("Summarize");
    });

    it("combines query and scope filter", () => {
      const result = useGeniesStore.getState().searchGenies("fix", "selection");
      expect(result).toHaveLength(1);
      expect(result[0].metadata.name).toBe("Fix Grammar");
    });

    it("returns empty when nothing matches", () => {
      const result = useGeniesStore.getState().searchGenies("zzz");
      expect(result).toEqual([]);
    });

    it("returns empty when scope doesn't match", () => {
      const result = useGeniesStore.getState().searchGenies("translate", "document");
      expect(result).toEqual([]);
    });
  });

  // ── getGroupedByCategory ────────────────────────────────────────────

  describe("getGroupedByCategory", () => {
    it("returns empty map when no genies loaded", () => {
      const grouped = useGeniesStore.getState().getGroupedByCategory();
      expect(grouped.size).toBe(0);
    });

    it("groups genies by category", () => {
      useGeniesStore.setState({
        genies: [
          makeGenie({ name: "A", metadata: { name: "A", description: "a", scope: "selection", category: "Writing" } }),
          makeGenie({ name: "B", metadata: { name: "B", description: "b", scope: "selection", category: "Language" } }),
          makeGenie({ name: "C", metadata: { name: "C", description: "c", scope: "selection", category: "Writing" } }),
        ],
      });
      const grouped = useGeniesStore.getState().getGroupedByCategory();
      expect(grouped.get("Writing")).toHaveLength(2);
      expect(grouped.get("Language")).toHaveLength(1);
    });

    it("uses 'Uncategorized' for genies without category", () => {
      useGeniesStore.setState({
        genies: [
          makeGenie({ name: "NoCat", metadata: { name: "NoCat", description: "x", scope: "selection" } }),
        ],
      });
      const grouped = useGeniesStore.getState().getGroupedByCategory();
      expect(grouped.get("Uncategorized")).toHaveLength(1);
    });
  });

  // ── getRecent ───────────────────────────────────────────────────────

  describe("getRecent", () => {
    it("returns matching genie definitions in MRU order", () => {
      const genies = [
        makeGenie({ name: "A" }),
        makeGenie({ name: "B" }),
        makeGenie({ name: "C" }),
      ];
      useGeniesStore.setState({
        genies,
        recentGenieNames: ["C", "A"],
      });
      const recent = useGeniesStore.getState().getRecent();
      expect(recent.map((g) => g.metadata.name)).toEqual(["C", "A"]);
    });

    it("skips recent names that no longer have a genie definition", () => {
      useGeniesStore.setState({
        genies: [makeGenie({ name: "A" })],
        recentGenieNames: ["A", "Deleted"],
      });
      const recent = useGeniesStore.getState().getRecent();
      expect(recent).toHaveLength(1);
      expect(recent[0].metadata.name).toBe("A");
    });

    it("returns empty when no recents", () => {
      useGeniesStore.setState({ genies: [makeGenie({ name: "A" })] });
      expect(useGeniesStore.getState().getRecent()).toEqual([]);
    });
  });

  // ── loadGenies ─────────────────────────────────────────────────────

  describe("loadGenies", () => {
    it("loads genies from Rust backend", async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "list_genies") {
          return [
            { name: "Translate", path: "/genies/Translate.md", source: "global", category: "Language" },
            { name: "Summarize", path: "/genies/Summarize.md", source: "global", category: null },
          ];
        }
        if (cmd === "read_genie") {
          const path = args?.path as string;
          if (path.includes("Translate")) {
            return {
              metadata: { name: "Translate", description: "Translate text", scope: "selection", category: "Language" },
              template: "Translate {{text}}",
            };
          }
          if (path.includes("Summarize")) {
            return {
              metadata: { name: "Summarize", description: "Summarize text", scope: "document" },
              template: "Summarize {{text}}",
            };
          }
        }
        return undefined;
      });

      await useGeniesStore.getState().loadGenies();

      const { genies, loading } = useGeniesStore.getState();
      expect(loading).toBe(false);
      expect(genies).toHaveLength(2);
      expect(genies[0].metadata.name).toBe("Translate");
      expect(genies[0].metadata.category).toBe("Language");
      expect(genies[0].template).toBe("Translate {{text}}");
      expect(genies[0].filePath).toBe("/genies/Translate.md");
      expect(genies[0].source).toBe("global");
    });

    it("prunes stale recents after loading", async () => {
      useGeniesStore.setState({
        recentGenieNames: ["Translate", "Deleted"],
        favoriteGenieNames: ["Translate", "AlsoDeleted"],
      });

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "list_genies") {
          return [{ name: "Translate", path: "/genies/Translate.md", source: "global", category: null }];
        }
        if (cmd === "read_genie") {
          return {
            metadata: { name: "Translate", description: "d", scope: "selection" },
            template: "t",
          };
        }
        return undefined;
      });

      await useGeniesStore.getState().loadGenies();

      const { recentGenieNames, favoriteGenieNames } = useGeniesStore.getState();
      expect(recentGenieNames).toEqual(["Translate"]);
      expect(favoriteGenieNames).toEqual(["Translate"]);
    });

    it("handles list_genies error gracefully", async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "list_genies") throw new Error("list failed");
        return undefined;
      });

      await useGeniesStore.getState().loadGenies();
      expect(useGeniesStore.getState().loading).toBe(false);
    });

    it("skips individual genie read failures", async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "list_genies") {
          return [
            { name: "Good", path: "/genies/Good.md", source: "global", category: null },
            { name: "Bad", path: "/genies/Bad.md", source: "global", category: null },
          ];
        }
        if (cmd === "read_genie") {
          const path = args?.path as string;
          if (path.includes("Bad")) throw new Error("corrupt file");
          return {
            metadata: { name: "Good", description: "d", scope: "selection" },
            template: "t",
          };
        }
        return undefined;
      });

      await useGeniesStore.getState().loadGenies();
      expect(useGeniesStore.getState().genies).toHaveLength(1);
      expect(useGeniesStore.getState().genies[0].metadata.name).toBe("Good");
    });

    it("falls back to entry category when metadata has none", async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "list_genies") {
          return [{ name: "X", path: "/genies/X.md", source: "global", category: "FolderCat" }];
        }
        if (cmd === "read_genie") {
          return {
            metadata: { name: "X", description: "d", scope: "selection" },
            template: "t",
          };
        }
        return undefined;
      });

      await useGeniesStore.getState().loadGenies();
      expect(useGeniesStore.getState().genies[0].metadata.category).toBe("FolderCat");
    });

    it("handles empty genie list", async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "list_genies") return [];
        return undefined;
      });

      await useGeniesStore.getState().loadGenies();
      expect(useGeniesStore.getState().genies).toEqual([]);
      expect(useGeniesStore.getState().loading).toBe(false);
    });
  });

  // ── addRecent edge cases ──────────────────────────────────────────

  describe("addRecent edge cases", () => {
    it("handles adding empty string as recent", () => {
      useGeniesStore.getState().addRecent("");
      expect(useGeniesStore.getState().recentGenieNames).toEqual([""]);
    });

    it("handles adding same name repeatedly", () => {
      const { addRecent } = useGeniesStore.getState();
      addRecent("X");
      addRecent("X");
      addRecent("X");
      expect(useGeniesStore.getState().recentGenieNames).toEqual(["X"]);
    });
  });

  // ── toggleFavorite edge cases ─────────────────────────────────────

  describe("toggleFavorite edge cases", () => {
    it("handles multiple favorites", () => {
      const { toggleFavorite } = useGeniesStore.getState();
      toggleFavorite("A");
      toggleFavorite("B");
      toggleFavorite("C");
      expect(useGeniesStore.getState().favoriteGenieNames).toEqual(["A", "B", "C"]);
    });

    it("removes from middle of favorites list", () => {
      useGeniesStore.setState({ favoriteGenieNames: ["A", "B", "C"] });
      useGeniesStore.getState().toggleFavorite("B");
      expect(useGeniesStore.getState().favoriteGenieNames).toEqual(["A", "C"]);
    });
  });

  // ── searchGenies edge cases ───────────────────────────────────────

  describe("searchGenies edge cases", () => {
    it("returns all genies when query is empty and scope is null", () => {
      useGeniesStore.setState({
        genies: [makeGenie({ name: "A" }), makeGenie({ name: "B" })],
      });
      const result = useGeniesStore.getState().searchGenies("", null);
      expect(result).toHaveLength(2);
    });

    it("searches case-insensitively in description", () => {
      useGeniesStore.setState({
        genies: [
          makeGenie({
            name: "X",
            metadata: { name: "X", description: "Fix UPPERCASE Issues", scope: "selection" },
          }),
        ],
      });
      const result = useGeniesStore.getState().searchGenies("uppercase");
      expect(result).toHaveLength(1);
    });

    it("handles genies with undefined category in search", () => {
      useGeniesStore.setState({
        genies: [
          makeGenie({ name: "NoCat", metadata: { name: "NoCat", description: "d", scope: "selection" } }),
        ],
      });
      // Should not throw when searching for text that would match category
      const result = useGeniesStore.getState().searchGenies("somecat");
      expect(result).toEqual([]);
    });
  });

  // ── loadGenies ─────────────────────────────────────────────────────

  describe("loadGenies", () => {
    it("loads genies and prunes stale recents/favorites (lines 113-129)", async () => {
      const mockInvoke = vi.mocked(invoke);
      // list_genies returns two entries
      mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "list_genies") {
          return [
            { path: "/genies/Alpha.md", category: "cat-a" },
            { path: "/genies/Beta.md", category: "cat-b" },
          ];
        }
        if (cmd === "read_genie") {
          const path = (args as { path: string }).path;
          if (path.includes("Alpha")) {
            return { metadata: { name: "Alpha", description: "d", scope: "selection" }, template: "t" };
          }
          return { metadata: { name: "Beta", description: "d", scope: "document" }, template: "t" };
        }
        return null;
      });

      // Set stale recents/favorites that include a non-existent genie
      useGeniesStore.setState({
        recentGenieNames: ["Alpha", "Deleted"],
        favoriteGenieNames: ["Beta", "Gone"],
      });

      await useGeniesStore.getState().loadGenies();

      const state = useGeniesStore.getState();
      expect(state.genies).toHaveLength(2);
      expect(state.loading).toBe(false);
      // Stale names should be pruned
      expect(state.recentGenieNames).toEqual(["Alpha"]);
      expect(state.favoriteGenieNames).toEqual(["Beta"]);
    });

    it("handles list_genies failure gracefully (line 127-131)", async () => {
      const mockInvoke = vi.mocked(invoke);
      mockInvoke.mockRejectedValueOnce(new Error("invoke failed"));

      await useGeniesStore.getState().loadGenies();

      const state = useGeniesStore.getState();
      expect(state.loading).toBe(false);
    });

    it("skips individual genie read failures (line 107-109)", async () => {
      const mockInvoke = vi.mocked(invoke);
      let callCount = 0;
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "list_genies") {
          return [
            { path: "/genies/Good.md", category: "cat" },
            { path: "/genies/Bad.md", category: "cat" },
          ];
        }
        if (cmd === "read_genie") {
          callCount++;
          if (callCount === 1) {
            return { metadata: { name: "Good", description: "d", scope: "selection" }, template: "t" };
          }
          throw new Error("read failed");
        }
        return null;
      });

      await useGeniesStore.getState().loadGenies();

      const state = useGeniesStore.getState();
      expect(state.genies).toHaveLength(1);
      expect(state.genies[0].metadata.name).toBe("Good");
    });
  });

  // ── loadGenies race guard ────────────────────────────────────────────

  describe("loadGenies race guard", () => {
    it("discards stale first load result when a second load starts before list_genies returns (line 89)", async () => {
      const mockInvoke = vi.mocked(invoke);

      // Use a promise to control when the first list_genies resolves
      let resolveFirstListGenies!: (value: unknown) => void;
      const firstListGeniesPending = new Promise((resolve) => {
        resolveFirstListGenies = resolve;
      });

      let callCount = 0;
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "list_genies") {
          callCount++;
          if (callCount === 1) {
            // First call: block until released
            return firstListGeniesPending;
          }
          // Second call: return immediately with a different genie
          return [{ path: "/genies/Second.md", category: null }];
        }
        if (cmd === "read_genie") {
          return { metadata: { name: "Second", description: "d", scope: "selection" }, template: "t" };
        }
        return null;
      });

      // Start first load (blocked)
      const load1 = useGeniesStore.getState().loadGenies();

      // Start second load (completes first since list_genies returns immediately)
      const load2 = useGeniesStore.getState().loadGenies();
      await load2;

      // Now release the first load's list_genies — it should detect stale and return early
      resolveFirstListGenies([{ path: "/genies/Stale.md", category: null }]);
      await load1;

      // Only the second load's result should be present
      const state = useGeniesStore.getState();
      expect(state.genies).toHaveLength(1);
      expect(state.genies[0].metadata.name).toBe("Second");
    });

    it("discards stale load result when a second load starts after read_genie calls complete (line 113)", async () => {
      const mockInvoke = vi.mocked(invoke);

      // Control resolution of read_genie for the first load
      let resolveFirstReadGenie!: (value: unknown) => void;
      const firstReadGeniePending = new Promise((resolve) => {
        resolveFirstReadGenie = resolve;
      });

      let listCallCount = 0;
      let readCallCount = 0;
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "list_genies") {
          listCallCount++;
          if (listCallCount === 1) {
            return [{ path: "/genies/First.md", category: null }];
          }
          return [{ path: "/genies/Second.md", category: null }];
        }
        if (cmd === "read_genie") {
          readCallCount++;
          if (readCallCount === 1) {
            // First load's read_genie: block
            return firstReadGeniePending;
          }
          return { metadata: { name: "Second", description: "d", scope: "selection" }, template: "t" };
        }
        return null;
      });

      // Start first load — its list_genies resolves, then blocks on read_genie
      const load1 = useGeniesStore.getState().loadGenies();

      // Wait for first load to have called list_genies and be blocked on read_genie
      await vi.waitFor(() => expect(readCallCount).toBeGreaterThanOrEqual(1));

      // Start second load — completes fully
      const load2 = useGeniesStore.getState().loadGenies();
      await load2;

      // Now release the first load's read_genie — it should detect stale after all reads
      resolveFirstReadGenie({ metadata: { name: "First", description: "d", scope: "selection" }, template: "t" });
      await load1;

      // Only second load's result should remain
      const state = useGeniesStore.getState();
      expect(state.genies).toHaveLength(1);
      expect(state.genies[0].metadata.name).toBe("Second");
    });
  });

  // ── SSR guard ───────────────────────────────────────────────────────

  it("store is functional (SSR guard does not break initialization)", () => {
    const state = useGeniesStore.getState();
    expect(Array.isArray(state.genies)).toBe(true);
    expect(typeof state.loadGenies).toBe("function");
    expect(typeof state.searchGenies).toBe("function");
    expect(typeof state.addRecent).toBe("function");
    expect(typeof state.toggleFavorite).toBe("function");
    expect(typeof state.isFavorite).toBe("function");
    expect(typeof state.getRecent).toBe("function");
    expect(typeof state.getGroupedByCategory).toBe("function");
  });
});
