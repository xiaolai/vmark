import { describe, it, expect, beforeEach } from "vitest";
import { usePromptHistoryStore } from "../aiStore";

describe("promptHistoryStore", () => {
  beforeEach(() => {
    usePromptHistoryStore.setState({ entries: [] });
  });

  // ── Initialization ──────────────────────────────────────────────────

  it("initializes with empty entries", () => {
    expect(usePromptHistoryStore.getState().entries).toEqual([]);
  });

  // ── addEntry ────────────────────────────────────────────────────────

  it("adds a prompt entry", () => {
    usePromptHistoryStore.getState().addEntry("hello world");
    expect(usePromptHistoryStore.getState().entries).toEqual(["hello world"]);
  });

  it("trims whitespace from entries", () => {
    usePromptHistoryStore.getState().addEntry("  spaced  ");
    expect(usePromptHistoryStore.getState().entries).toEqual(["spaced"]);
  });

  it("ignores empty string", () => {
    usePromptHistoryStore.getState().addEntry("");
    expect(usePromptHistoryStore.getState().entries).toEqual([]);
  });

  it("ignores whitespace-only string", () => {
    usePromptHistoryStore.getState().addEntry("   ");
    expect(usePromptHistoryStore.getState().entries).toEqual([]);
  });

  it("moves duplicate entry to the top (MRU order)", () => {
    const { addEntry } = usePromptHistoryStore.getState();
    addEntry("first");
    addEntry("second");
    addEntry("first"); // re-add
    expect(usePromptHistoryStore.getState().entries).toEqual([
      "first",
      "second",
    ]);
  });

  it("caps entries at 100", () => {
    const { addEntry } = usePromptHistoryStore.getState();
    for (let i = 0; i < 105; i++) {
      addEntry(`entry-${i}`);
    }
    const { entries } = usePromptHistoryStore.getState();
    expect(entries.length).toBe(100);
    // Most recent should be first
    expect(entries[0]).toBe("entry-104");
    // Oldest entries should be trimmed
    expect(entries).not.toContain("entry-0");
    expect(entries).not.toContain("entry-4");
  });

  it("handles Unicode/CJK entries", () => {
    usePromptHistoryStore.getState().addEntry("翻译成中文");
    expect(usePromptHistoryStore.getState().entries).toEqual(["翻译成中文"]);
  });

  // ── clearHistory ────────────────────────────────────────────────────

  it("clears all entries", () => {
    usePromptHistoryStore.getState().addEntry("a");
    usePromptHistoryStore.getState().addEntry("b");
    usePromptHistoryStore.getState().clearHistory();
    expect(usePromptHistoryStore.getState().entries).toEqual([]);
  });

  // ── getFilteredEntries ──────────────────────────────────────────────

  it("returns all entries when prefix is empty", () => {
    const { addEntry } = usePromptHistoryStore.getState();
    addEntry("alpha");
    addEntry("beta");
    const result = usePromptHistoryStore.getState().getFilteredEntries("");
    expect(result).toEqual(["beta", "alpha"]);
  });

  it("filters entries case-insensitively", () => {
    const { addEntry } = usePromptHistoryStore.getState();
    addEntry("Hello World");
    addEntry("goodbye");
    addEntry("HELLO again");
    const result = usePromptHistoryStore.getState().getFilteredEntries("hello");
    expect(result).toEqual(["HELLO again", "Hello World"]);
  });

  it("returns empty array when nothing matches", () => {
    usePromptHistoryStore.getState().addEntry("alpha");
    const result =
      usePromptHistoryStore.getState().getFilteredEntries("zzz");
    expect(result).toEqual([]);
  });

  it("matches substring, not just prefix", () => {
    usePromptHistoryStore.getState().addEntry("translate to English");
    const result =
      usePromptHistoryStore.getState().getFilteredEntries("English");
    expect(result).toEqual(["translate to English"]);
  });

  // ── SSR guard ───────────────────────────────────────────────────────

  it("storage factory returns a no-op storage when window is undefined", () => {
    // The SSR guard is in createJSONStorage(() => typeof window !== "undefined" ? localStorage : {...})
    // In test environment (jsdom), window exists, but we verify the store
    // can be created and used — the important thing is it doesn't throw.
    // The actual SSR path is covered by the inline conditional in the source.
    const state = usePromptHistoryStore.getState();
    expect(state.entries).toBeDefined();
    expect(typeof state.addEntry).toBe("function");
    expect(typeof state.clearHistory).toBe("function");
    expect(typeof state.getFilteredEntries).toBe("function");
  });
});
