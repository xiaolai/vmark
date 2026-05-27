/**
 * Tests for CJK-aware bold/italic input and paste rule regexes.
 *
 * Verifies that the lookbehind-based regexes match CJK text, Latin text,
 * start-of-text, and correctly reject malformed patterns (e.g., `***`).
 */

import { describe, it, expect, vi } from "vitest";
import {
  boldStarInputRegex,
  boldStarPasteRegex,
  boldUnderscoreInputRegex,
  boldUnderscorePasteRegex,
  italicStarInputRegex,
  italicStarPasteRegex,
  italicUnderscoreInputRegex,
  italicUnderscorePasteRegex,
  CJKBold,
  CJKItalic,
} from "../tiptap";

// Helper: test whether regex matches and extract the inner text (capture group 2)
function inputMatch(regex: RegExp, text: string): string | null {
  const m = text.match(regex);
  return m ? m[2] : null;
}

function pasteMatches(regex: RegExp, text: string): string[] {
  // Reset lastIndex for global regexes
  regex.lastIndex = 0;
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    results.push(m[2]);
  }
  return results;
}

// ─── Bold star (**text**) ───

describe("boldStarInputRegex", () => {
  it("matches Latin text with space prefix", () => {
    expect(inputMatch(boldStarInputRegex, "Hello **world**")).toBe("world");
  });

  it("matches CJK text without space", () => {
    expect(inputMatch(boldStarInputRegex, "你好**世界**")).toBe("世界");
  });

  it("matches at start of text", () => {
    expect(inputMatch(boldStarInputRegex, "**hello**")).toBe("hello");
  });

  it("rejects triple star prefix (malformed)", () => {
    expect(inputMatch(boldStarInputRegex, "***world**")).toBeNull();
  });

  it("matches after punctuation", () => {
    expect(inputMatch(boldStarInputRegex, "end.**bold**")).toBe("bold");
  });

  it("rejects content with only spaces", () => {
    expect(inputMatch(boldStarInputRegex, "**   **")).toBeNull();
  });
});

describe("boldStarPasteRegex", () => {
  it("matches CJK text in paste", () => {
    expect(pasteMatches(boldStarPasteRegex, "你好**世界**再见")).toEqual(["世界"]);
  });

  it("matches multiple occurrences", () => {
    expect(pasteMatches(boldStarPasteRegex, "**a** and **b**")).toEqual(["a", "b"]);
  });

  it("matches Latin text with space prefix", () => {
    expect(pasteMatches(boldStarPasteRegex, "Hello **world**")).toEqual(["world"]);
  });
});

// ─── Bold underscore (__text__) ───

describe("boldUnderscoreInputRegex", () => {
  it("matches Latin text with space prefix", () => {
    expect(inputMatch(boldUnderscoreInputRegex, "Hello __world__")).toBe("world");
  });

  it("matches CJK text without space", () => {
    expect(inputMatch(boldUnderscoreInputRegex, "你好__世界__")).toBe("世界");
  });

  it("matches at start of text", () => {
    expect(inputMatch(boldUnderscoreInputRegex, "__hello__")).toBe("hello");
  });

  it("rejects triple underscore prefix", () => {
    expect(inputMatch(boldUnderscoreInputRegex, "___world__")).toBeNull();
  });
});

describe("boldUnderscorePasteRegex", () => {
  it("matches CJK text in paste", () => {
    expect(pasteMatches(boldUnderscorePasteRegex, "你好__世界__再见")).toEqual(["世界"]);
  });

  it("matches multiple occurrences", () => {
    expect(pasteMatches(boldUnderscorePasteRegex, "__a__ and __b__")).toEqual(["a", "b"]);
  });
});

// ─── Italic star (*text*) ───

describe("italicStarInputRegex", () => {
  it("matches Latin text with space prefix", () => {
    expect(inputMatch(italicStarInputRegex, "Hello *world*")).toBe("world");
  });

  it("matches CJK text without space", () => {
    expect(inputMatch(italicStarInputRegex, "你好*世界*")).toBe("世界");
  });

  it("matches at start of text", () => {
    expect(inputMatch(italicStarInputRegex, "*hello*")).toBe("hello");
  });

  it("rejects double star prefix (that's bold)", () => {
    expect(inputMatch(italicStarInputRegex, "**world*")).toBeNull();
  });

  it("matches after punctuation", () => {
    expect(inputMatch(italicStarInputRegex, "end.*italic*")).toBe("italic");
  });
});

describe("italicStarPasteRegex", () => {
  it("matches CJK text in paste", () => {
    expect(pasteMatches(italicStarPasteRegex, "你好*世界*再见")).toEqual(["世界"]);
  });

  it("matches multiple occurrences", () => {
    expect(pasteMatches(italicStarPasteRegex, "*a* and *b*")).toEqual(["a", "b"]);
  });
});

// ─── Italic underscore (_text_) ───

describe("italicUnderscoreInputRegex", () => {
  it("matches Latin text with space prefix", () => {
    expect(inputMatch(italicUnderscoreInputRegex, "Hello _world_")).toBe("world");
  });

  it("matches CJK text without space", () => {
    expect(inputMatch(italicUnderscoreInputRegex, "你好_世界_")).toBe("世界");
  });

  it("matches at start of text", () => {
    expect(inputMatch(italicUnderscoreInputRegex, "_hello_")).toBe("hello");
  });

  it("rejects double underscore prefix (that's bold)", () => {
    expect(inputMatch(italicUnderscoreInputRegex, "__world_")).toBeNull();
  });
});

describe("italicUnderscorePasteRegex", () => {
  it("matches CJK text in paste", () => {
    expect(pasteMatches(italicUnderscorePasteRegex, "你好_世界_再见")).toEqual(["世界"]);
  });

  it("matches multiple occurrences", () => {
    expect(pasteMatches(italicUnderscorePasteRegex, "_a_ and _b_")).toEqual(["a", "b"]);
  });

  // CommonMark intraword `_` rule — `_` flanked by word characters on both
  // sides MUST NOT emphasize. The classic regression: pasting a Wikipedia
  // URL whose path contains underscores between words (`Pardon_of_January_6
  // _United_States...`) used to italicize "of", "6", "States", "attack"
  // inside the auto-linked URL.
  it("does NOT match intraword underscores (regression: URL with _word_)", () => {
    const url =
      "https://en.wikipedia.org/wiki/Pardon_of_January_6_United_States_Capitol_attack_defendants";
    expect(pasteMatches(italicUnderscorePasteRegex, url)).toEqual([]);
  });

  it("does NOT match the classic `foo_bar_baz` snake-case identifier", () => {
    expect(pasteMatches(italicUnderscorePasteRegex, "foo_bar_baz")).toEqual([]);
  });

  it("does NOT match when the closing underscore is followed by a word char", () => {
    // Opening `_` after a non-word, but closing `_` runs into another word —
    // CommonMark rejects this as intraword on the right side.
    expect(pasteMatches(italicUnderscorePasteRegex, "see _word_more")).toEqual([]);
  });

  it("still matches at boundaries with punctuation / whitespace / CJK", () => {
    expect(pasteMatches(italicUnderscorePasteRegex, "(see _key_!)")).toEqual(["key"]);
    expect(pasteMatches(italicUnderscorePasteRegex, "你好_世界_,再见")).toEqual(["世界"]);
  });
});

describe("italicUnderscoreInputRegex (intraword guard)", () => {
  it("does NOT trigger italic when typing snake_case identifiers", () => {
    expect(inputMatch(italicUnderscoreInputRegex, "foo_bar_")).toBeNull();
  });

  it("does NOT trigger italic when typing a URL path with underscores", () => {
    expect(
      inputMatch(italicUnderscoreInputRegex, "wiki/Pardon_of_"),
    ).toBeNull();
  });
});

describe("boldUnderscorePasteRegex (intraword guard)", () => {
  it("does NOT match intraword `__bold__` flanked by word characters on both sides", () => {
    expect(pasteMatches(boldUnderscorePasteRegex, "foo__bar__baz")).toEqual([]);
  });

  it("still matches `__bold__` at word boundaries", () => {
    expect(pasteMatches(boldUnderscorePasteRegex, "see __key__ now")).toEqual(["key"]);
  });
});

// --- Extension structure tests ---

describe("CJKBold extension", () => {
  it("has name 'bold'", () => {
    expect(CJKBold.name).toBe("bold");
  });

  it("is a Mark type", () => {
    expect(CJKBold.type).toBe("mark");
  });

  it("defines addOptions with HTMLAttributes", () => {
    expect(CJKBold.config.addOptions).toBeDefined();
    const options = CJKBold.config.addOptions!.call({} as never);
    expect(options).toEqual({ HTMLAttributes: {} });
  });

  it("defines parseHTML rules for strong, b, and font-weight", () => {
    const parseRules = CJKBold.config.parseHTML!.call({
      name: "bold",
    } as never);
    expect(parseRules.length).toBeGreaterThanOrEqual(3);
    expect(parseRules[0]).toEqual({ tag: "strong" });
  });

  it("renders as <strong> tag", () => {
    const result = CJKBold.config.renderHTML!.call(
      { options: { HTMLAttributes: {} } } as never,
      { HTMLAttributes: {} } as never
    );
    expect(result[0]).toBe("strong");
  });

  it("defines addCommands with setBold, toggleBold, unsetBold", () => {
    const commands = CJKBold.config.addCommands!.call({
      name: "bold",
    } as never);
    expect(commands).toHaveProperty("setBold");
    expect(commands).toHaveProperty("toggleBold");
    expect(commands).toHaveProperty("unsetBold");
  });

  it("defines keyboard shortcuts Mod-b and Mod-B", () => {
    const shortcuts = CJKBold.config.addKeyboardShortcuts!.call({
      editor: { commands: { toggleBold: vi.fn() } },
    } as never);
    expect(shortcuts).toHaveProperty("Mod-b");
    expect(shortcuts).toHaveProperty("Mod-B");
  });

  it("defines two input rules (star and underscore)", () => {
    const inputRules = CJKBold.config.addInputRules!.call({
      type: {} as never,
    } as never);
    expect(inputRules).toHaveLength(2);
  });

  it("defines two paste rules (star and underscore)", () => {
    const pasteRules = CJKBold.config.addPasteRules!.call({
      type: {} as never,
    } as never);
    expect(pasteRules).toHaveLength(2);
  });
});

describe("CJKItalic extension", () => {
  it("has name 'italic'", () => {
    expect(CJKItalic.name).toBe("italic");
  });

  it("is a Mark type", () => {
    expect(CJKItalic.type).toBe("mark");
  });

  it("defines addOptions with HTMLAttributes", () => {
    const options = CJKItalic.config.addOptions!.call({} as never);
    expect(options).toEqual({ HTMLAttributes: {} });
  });

  it("defines parseHTML rules for em, i, and font-style", () => {
    const parseRules = CJKItalic.config.parseHTML!.call({
      name: "italic",
    } as never);
    expect(parseRules.length).toBeGreaterThanOrEqual(3);
    expect(parseRules[0]).toEqual({ tag: "em" });
  });

  it("renders as <em> tag", () => {
    const result = CJKItalic.config.renderHTML!.call(
      { options: { HTMLAttributes: {} } } as never,
      { HTMLAttributes: {} } as never
    );
    expect(result[0]).toBe("em");
  });

  it("defines addCommands with setItalic, toggleItalic, unsetItalic", () => {
    const commands = CJKItalic.config.addCommands!.call({
      name: "italic",
    } as never);
    expect(commands).toHaveProperty("setItalic");
    expect(commands).toHaveProperty("toggleItalic");
    expect(commands).toHaveProperty("unsetItalic");
  });

  it("defines keyboard shortcuts Mod-i and Mod-I", () => {
    const shortcuts = CJKItalic.config.addKeyboardShortcuts!.call({
      editor: { commands: { toggleItalic: vi.fn() } },
    } as never);
    expect(shortcuts).toHaveProperty("Mod-i");
    expect(shortcuts).toHaveProperty("Mod-I");
  });

  it("defines two input rules (star and underscore)", () => {
    const inputRules = CJKItalic.config.addInputRules!.call({
      type: {} as never,
    } as never);
    expect(inputRules).toHaveLength(2);
  });

  it("defines two paste rules (star and underscore)", () => {
    const pasteRules = CJKItalic.config.addPasteRules!.call({
      type: {} as never,
    } as never);
    expect(pasteRules).toHaveLength(2);
  });
});

// --- Additional regex edge case tests ---

describe("bold star edge cases", () => {
  it("matches multi-word bold", () => {
    expect(inputMatch(boldStarInputRegex, "**hello world**")).toBe("hello world");
  });

  it("matches bold with numbers", () => {
    expect(inputMatch(boldStarInputRegex, "**12345**")).toBe("12345");
  });

  it("matches bold with special characters", () => {
    expect(inputMatch(boldStarInputRegex, "**hello!@#**")).toBe("hello!@#");
  });

  it("rejects empty bold markers", () => {
    expect(inputMatch(boldStarInputRegex, "****")).toBeNull();
  });
});

describe("italic star edge cases", () => {
  it("matches multi-word italic", () => {
    expect(inputMatch(italicStarInputRegex, "*hello world*")).toBe("hello world");
  });

  it("matches italic with numbers", () => {
    expect(inputMatch(italicStarInputRegex, "*12345*")).toBe("12345");
  });

  it("rejects empty italic markers", () => {
    expect(inputMatch(italicStarInputRegex, "**")).toBeNull();
  });
});

describe("bold underscore edge cases", () => {
  it("matches multi-word bold", () => {
    expect(inputMatch(boldUnderscoreInputRegex, "__hello world__")).toBe("hello world");
  });

  it("matches after CJK characters", () => {
    expect(inputMatch(boldUnderscoreInputRegex, "测试__内容__")).toBe("内容");
  });
});

describe("italic underscore edge cases", () => {
  it("matches multi-word italic", () => {
    expect(inputMatch(italicUnderscoreInputRegex, "_hello world_")).toBe("hello world");
  });

  it("matches after CJK characters", () => {
    expect(inputMatch(italicUnderscoreInputRegex, "测试_内容_")).toBe("内容");
  });
});

describe("paste regex with mixed content", () => {
  it("handles bold stars in complex text", () => {
    const text = "Some text **bold1** middle **bold2** end";
    expect(pasteMatches(boldStarPasteRegex, text)).toEqual(["bold1", "bold2"]);
  });

  it("handles italic stars in complex text", () => {
    const text = "Some text *italic1* middle *italic2* end";
    expect(pasteMatches(italicStarPasteRegex, text)).toEqual(["italic1", "italic2"]);
  });

  it("handles bold underscores in complex text", () => {
    const text = "Some text __bold1__ middle __bold2__ end";
    expect(pasteMatches(boldUnderscorePasteRegex, text)).toEqual(["bold1", "bold2"]);
  });

  it("handles italic underscores in complex text", () => {
    const text = "Some text _italic1_ middle _italic2_ end";
    expect(pasteMatches(italicUnderscorePasteRegex, text)).toEqual(["italic1", "italic2"]);
  });
});

// --- parseHTML callback tests ---

describe("CJKBold parseHTML callbacks", () => {
  function getBoldParseRules() {
    return CJKBold.config.parseHTML!.call({ name: "bold" } as never);
  }

  it("<b> getAttrs returns null when fontWeight is not 'normal'", () => {
    const rules = getBoldParseRules();
    const bRule = rules[1]; // { tag: "b", getAttrs: ... }
    expect(bRule.tag).toBe("b");

    // fontWeight = "bold" => should match (returns null = match)
    const boldElement = { style: { fontWeight: "bold" } } as HTMLElement;
    expect(bRule.getAttrs!(boldElement as never)).toBeNull();
  });

  it("<b> getAttrs returns false when fontWeight is 'normal'", () => {
    const rules = getBoldParseRules();
    const bRule = rules[1];
    const normalElement = { style: { fontWeight: "normal" } } as HTMLElement;
    expect(bRule.getAttrs!(normalElement as never)).toBe(false);
  });

  it("<b> getAttrs returns null for empty fontWeight", () => {
    const rules = getBoldParseRules();
    const bRule = rules[1];
    const emptyElement = { style: { fontWeight: "" } } as HTMLElement;
    // "" !== "normal" => true, true && null => null
    expect(bRule.getAttrs!(emptyElement as never)).toBeNull();
  });

  it("font-weight=400 clearMark identifies bold marks", () => {
    const rules = getBoldParseRules();
    const clearRule = rules[2]; // { style: "font-weight=400", clearMark: ... }
    expect(clearRule.style).toBe("font-weight=400");
    expect(clearRule.clearMark).toBeDefined();

    // Mark with name "bold" should return true
    expect(clearRule.clearMark!({ type: { name: "bold" } } as never)).toBe(true);
    // Mark with name "italic" should return false
    expect(clearRule.clearMark!({ type: { name: "italic" } } as never)).toBe(false);
  });

  it("font-weight style getAttrs matches bold values", () => {
    const rules = getBoldParseRules();
    const weightRule = rules[3]; // { style: "font-weight", getAttrs: ... }
    expect(weightRule.style).toBe("font-weight");

    // "bold" should match => null
    expect(weightRule.getAttrs!("bold" as never)).toBeNull();
    // "bolder" should match => null
    expect(weightRule.getAttrs!("bolder" as never)).toBeNull();
    // "500" should match => null
    expect(weightRule.getAttrs!("500" as never)).toBeNull();
    // "900" should match => null
    expect(weightRule.getAttrs!("900" as never)).toBeNull();
    // "400" should NOT match => false
    expect(weightRule.getAttrs!("400" as never)).toBe(false);
    // "normal" should NOT match => false
    expect(weightRule.getAttrs!("normal" as never)).toBe(false);
    // "300" should NOT match
    expect(weightRule.getAttrs!("300" as never)).toBe(false);
  });
});

describe("CJKItalic parseHTML callbacks", () => {
  function getItalicParseRules() {
    return CJKItalic.config.parseHTML!.call({ name: "italic" } as never);
  }

  it("<i> getAttrs returns null when fontStyle is not 'normal'", () => {
    const rules = getItalicParseRules();
    const iRule = rules[1]; // { tag: "i", getAttrs: ... }
    expect(iRule.tag).toBe("i");

    const italicElement = { style: { fontStyle: "italic" } } as HTMLElement;
    expect(iRule.getAttrs!(italicElement as never)).toBeNull();
  });

  it("<i> getAttrs returns false when fontStyle is 'normal'", () => {
    const rules = getItalicParseRules();
    const iRule = rules[1];
    const normalElement = { style: { fontStyle: "normal" } } as HTMLElement;
    expect(iRule.getAttrs!(normalElement as never)).toBe(false);
  });

  it("font-style=normal clearMark identifies italic marks", () => {
    const rules = getItalicParseRules();
    const clearRule = rules[2]; // { style: "font-style=normal", clearMark: ... }
    expect(clearRule.style).toBe("font-style=normal");
    expect(clearRule.clearMark).toBeDefined();

    expect(clearRule.clearMark!({ type: { name: "italic" } } as never)).toBe(true);
    expect(clearRule.clearMark!({ type: { name: "bold" } } as never)).toBe(false);
  });

  it("has font-style=italic rule", () => {
    const rules = getItalicParseRules();
    const italicRule = rules[3];
    expect(italicRule.style).toBe("font-style=italic");
  });
});

// --- Command execution tests ---

describe("CJKBold command execution", () => {
  it("setBold calls commands.setMark", () => {
    const commands = CJKBold.config.addCommands!.call({ name: "bold" } as never);
    const mockSetMark = vi.fn(() => true);
    const result = commands.setBold()({ commands: { setMark: mockSetMark } } as never);
    expect(mockSetMark).toHaveBeenCalledWith("bold");
    expect(result).toBe(true);
  });

  it("toggleBold calls commands.toggleMark", () => {
    const commands = CJKBold.config.addCommands!.call({ name: "bold" } as never);
    const mockToggleMark = vi.fn(() => true);
    const result = commands.toggleBold()({ commands: { toggleMark: mockToggleMark } } as never);
    expect(mockToggleMark).toHaveBeenCalledWith("bold");
    expect(result).toBe(true);
  });

  it("unsetBold calls commands.unsetMark", () => {
    const commands = CJKBold.config.addCommands!.call({ name: "bold" } as never);
    const mockUnsetMark = vi.fn(() => true);
    const result = commands.unsetBold()({ commands: { unsetMark: mockUnsetMark } } as never);
    expect(mockUnsetMark).toHaveBeenCalledWith("bold");
    expect(result).toBe(true);
  });
});

describe("CJKItalic command execution", () => {
  it("setItalic calls commands.setMark", () => {
    const commands = CJKItalic.config.addCommands!.call({ name: "italic" } as never);
    const mockSetMark = vi.fn(() => true);
    const result = commands.setItalic()({ commands: { setMark: mockSetMark } } as never);
    expect(mockSetMark).toHaveBeenCalledWith("italic");
    expect(result).toBe(true);
  });

  it("toggleItalic calls commands.toggleMark", () => {
    const commands = CJKItalic.config.addCommands!.call({ name: "italic" } as never);
    const mockToggleMark = vi.fn(() => true);
    const result = commands.toggleItalic()({ commands: { toggleMark: mockToggleMark } } as never);
    expect(mockToggleMark).toHaveBeenCalledWith("italic");
    expect(result).toBe(true);
  });

  it("unsetItalic calls commands.unsetMark", () => {
    const commands = CJKItalic.config.addCommands!.call({ name: "italic" } as never);
    const mockUnsetMark = vi.fn(() => true);
    const result = commands.unsetItalic()({ commands: { unsetMark: mockUnsetMark } } as never);
    expect(mockUnsetMark).toHaveBeenCalledWith("italic");
    expect(result).toBe(true);
  });
});

// --- Keyboard shortcut execution tests ---

describe("CJKBold keyboard shortcut execution", () => {
  it("Mod-b toggles bold", () => {
    const mockToggleBold = vi.fn(() => true);
    const shortcuts = CJKBold.config.addKeyboardShortcuts!.call({
      editor: { commands: { toggleBold: mockToggleBold } },
    } as never);
    shortcuts["Mod-b"]();
    expect(mockToggleBold).toHaveBeenCalled();
  });

  it("Mod-B toggles bold", () => {
    const mockToggleBold = vi.fn(() => true);
    const shortcuts = CJKBold.config.addKeyboardShortcuts!.call({
      editor: { commands: { toggleBold: mockToggleBold } },
    } as never);
    shortcuts["Mod-B"]();
    expect(mockToggleBold).toHaveBeenCalled();
  });
});

describe("CJKItalic keyboard shortcut execution", () => {
  it("Mod-i toggles italic", () => {
    const mockToggleItalic = vi.fn(() => true);
    const shortcuts = CJKItalic.config.addKeyboardShortcuts!.call({
      editor: { commands: { toggleItalic: mockToggleItalic } },
    } as never);
    shortcuts["Mod-i"]();
    expect(mockToggleItalic).toHaveBeenCalled();
  });

  it("Mod-I toggles italic", () => {
    const mockToggleItalic = vi.fn(() => true);
    const shortcuts = CJKItalic.config.addKeyboardShortcuts!.call({
      editor: { commands: { toggleItalic: mockToggleItalic } },
    } as never);
    shortcuts["Mod-I"]();
    expect(mockToggleItalic).toHaveBeenCalled();
  });
});

// --- renderHTML with merged attributes ---

describe("CJKBold renderHTML with custom HTMLAttributes", () => {
  it("merges custom HTMLAttributes into strong tag", () => {
    const result = CJKBold.config.renderHTML!.call(
      { options: { HTMLAttributes: { class: "custom-bold" } } } as never,
      { HTMLAttributes: { id: "test" } } as never
    );
    expect(result[0]).toBe("strong");
    expect(result[1]).toEqual(expect.objectContaining({ class: "custom-bold", id: "test" }));
    expect(result[2]).toBe(0);
  });
});

describe("CJKItalic renderHTML with custom HTMLAttributes", () => {
  it("merges custom HTMLAttributes into em tag", () => {
    const result = CJKItalic.config.renderHTML!.call(
      { options: { HTMLAttributes: { class: "custom-italic" } } } as never,
      { HTMLAttributes: { id: "test" } } as never
    );
    expect(result[0]).toBe("em");
    expect(result[1]).toEqual(expect.objectContaining({ class: "custom-italic", id: "test" }));
    expect(result[2]).toBe(0);
  });
});
