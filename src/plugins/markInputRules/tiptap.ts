/**
 * CJK-Aware Bold & Italic Extensions
 *
 * Purpose: Replaces Tiptap's default Bold and Italic input/paste rules with
 * CJK-compatible versions. The originals use `(?:^|\s)` which requires
 * whitespace before markers — CJK characters aren't `\s`, so `你好**世界**`
 * never triggers. These use lookbehind `(?<=^|[^*])` / `(?<=^|[^_])` instead.
 *
 * @coordinates-with tiptapExtensions.ts — registered after StarterKit (with bold/italic disabled)
 * @module plugins/markInputRules/tiptap
 */

import { Mark, markInputRule, mergeAttributes } from "@tiptap/core";
import { urlSafeMarkPasteRule } from "./urlSafePasteRule";

// --- Bold regexes (CJK-aware) ---

/** Matches `**text**` preceded by any non-`*` character or start of text */
export const boldStarInputRegex =
  /(?<=^|[^*])(\*\*(?!\s+\*\*)((?:[^*]+))\*\*(?!\s+\*\*))$/;

/** Paste rule regex for `**text**` bold with CJK-aware lookbehind. */
export const boldStarPasteRegex =
  /(?<=^|[^*])(\*\*(?!\s+\*\*)((?:[^*]+))\*\*(?!\s+\*\*))/g;

// --- Unicode-aware boundary fragments for underscore emphasis ---
//
// Per CommonMark, an underscore flanked by word characters on both sides
// must not emphasize (the rule that distinguishes `_` from `*`). We extend
// "word character" to the full Unicode letter+number set so Cyrillic /
// Greek / Arabic / etc. snake_case identifiers and URL path segments are
// also rejected (audit Round B H2). CJK letters are explicitly allowed
// as a permitted boundary, preserving the project's deliberate CJK
// divergence — CJK has no inter-word spacing, so `你好_世界_` is the
// natural way to write emphasized CJK and must keep working.
const CJK_SCRIPT = "[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Bopomofo}]";
const NON_WORDISH = "[^\\p{L}\\p{N}_]";
const ALLOWED_BEFORE = `(?<=^|${NON_WORDISH}|${CJK_SCRIPT})`;
const ALLOWED_AFTER = `(?=$|${NON_WORDISH}|${CJK_SCRIPT})`;

/** Matches `__text__` with Unicode-aware boundaries that reject intraword `_`. */
export const boldUnderscoreInputRegex = new RegExp(
  `${ALLOWED_BEFORE}(__(?!\\s+__)((?:[^_]+))__${ALLOWED_AFTER}(?!\\s+__))$`,
  "u",
);

/** Paste rule regex for `__text__` bold with Unicode-aware boundaries. */
export const boldUnderscorePasteRegex = new RegExp(
  `${ALLOWED_BEFORE}(__(?!\\s+__)((?:[^_]+))__${ALLOWED_AFTER}(?!\\s+__))`,
  "gu",
);

// --- Italic regexes (CJK-aware) ---

/** Matches `*text*` preceded by any non-`*` character or start of text */
export const italicStarInputRegex =
  /(?<=^|[^*])(\*(?!\s+\*)((?:[^*]+))\*(?!\s+\*))$/;

/** Paste rule regex for `*text*` italic with CJK-aware lookbehind. */
export const italicStarPasteRegex =
  /(?<=^|[^*])(\*(?!\s+\*)((?:[^*]+))\*(?!\s+\*))/g;

/** Matches `_text_` with Unicode-aware boundaries that reject intraword `_`. */
export const italicUnderscoreInputRegex = new RegExp(
  `${ALLOWED_BEFORE}(_(?!\\s+_)((?:[^_]+))_${ALLOWED_AFTER}(?!\\s+_))$`,
  "u",
);

/** Paste rule regex for `_text_` italic with Unicode-aware boundaries. */
export const italicUnderscorePasteRegex = new RegExp(
  `${ALLOWED_BEFORE}(_(?!\\s+_)((?:[^_]+))_${ALLOWED_AFTER}(?!\\s+_))`,
  "gu",
);

// --- Extensions ---

/**
 * CJK-aware Bold extension. Drop-in replacement for `@tiptap/extension-bold`
 * with fixed input/paste rules that work with CJK text.
 */
export const CJKBold = Mark.create({
  name: "bold",

  addOptions() {
    return { HTMLAttributes: {} };
  },

  parseHTML() {
    return [
      { tag: "strong" },
      { tag: "b", getAttrs: (node) => (node as HTMLElement).style.fontWeight !== "normal" && null },
      { style: "font-weight=400", clearMark: (mark) => mark.type.name === this.name },
      { style: "font-weight", getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value as string) && null },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["strong", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setBold: () => ({ commands }) => commands.setMark(this.name),
      toggleBold: () => ({ commands }) => commands.toggleMark(this.name),
      unsetBold: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-b": () => this.editor.commands.toggleBold(),
      "Mod-B": () => this.editor.commands.toggleBold(),
    };
  },

  addInputRules() {
    return [
      markInputRule({ find: boldStarInputRegex, type: this.type }),
      markInputRule({ find: boldUnderscoreInputRegex, type: this.type }),
    ];
  },

  addPasteRules() {
    return [
      urlSafeMarkPasteRule({ find: boldStarPasteRegex, type: this.type }),
      urlSafeMarkPasteRule({ find: boldUnderscorePasteRegex, type: this.type }),
    ];
  },
});

/**
 * CJK-aware Italic extension. Drop-in replacement for `@tiptap/extension-italic`
 * with fixed input/paste rules that work with CJK text.
 */
export const CJKItalic = Mark.create({
  name: "italic",

  addOptions() {
    return { HTMLAttributes: {} };
  },

  parseHTML() {
    return [
      { tag: "em" },
      { tag: "i", getAttrs: (node) => (node as HTMLElement).style.fontStyle !== "normal" && null },
      { style: "font-style=normal", clearMark: (mark) => mark.type.name === this.name },
      { style: "font-style=italic" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["em", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setItalic: () => ({ commands }) => commands.setMark(this.name),
      toggleItalic: () => ({ commands }) => commands.toggleMark(this.name),
      unsetItalic: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-i": () => this.editor.commands.toggleItalic(),
      "Mod-I": () => this.editor.commands.toggleItalic(),
    };
  },

  addInputRules() {
    return [
      markInputRule({ find: italicStarInputRegex, type: this.type }),
      markInputRule({ find: italicUnderscoreInputRegex, type: this.type }),
    ];
  },

  addPasteRules() {
    return [
      urlSafeMarkPasteRule({ find: italicStarPasteRegex, type: this.type }),
      urlSafeMarkPasteRule({ find: italicUnderscorePasteRegex, type: this.type }),
    ];
  },
});
