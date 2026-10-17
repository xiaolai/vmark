/**
 * Code Block Extension with Line Numbers
 *
 * Purpose: Extends CodeBlockLowlight with a custom NodeView that renders a
 * line-number gutter, a copy button, and a language selector chip, providing
 * a code-editor-like experience in WYSIWYG.
 *
 * Pipeline: ProseMirror code block node → CodeBlockNodeView (DOM scaffolding,
 * gutter, copy button, language chip) → LanguageDropdown (dropdown lifecycle,
 * filtering, keyboard nav).
 *
 * Key decisions:
 *   - Built on CodeBlockLowlight (not raw CodeBlock) for syntax highlighting via lowlight
 *   - `defaultLanguage: "plaintext"` prevents `lowlight.highlightAuto()` from
 *     mis-detecting empty-language blocks as VB.NET (which italicizes
 *     apostrophe contractions via the `hljs-comment` CSS rule)
 *   - Line numbers are rendered in a separate gutter div that updates on every mutation
 *   - Language selector is a floating chip positioned inside the code block wrapper
 *   - Language dropdown uses fixed positioning (popup-host aware) to avoid clipping
 *   - Copy button uses navigator.clipboard API with success/error feedback
 *   - `meta` holds the fence info after the language (```` ```js {1,3} ````) so
 *     a document round-trips it. It is markdown-only: never rendered to HTML,
 *     and never read from pasted HTML.
 *   - `addProseMirrorPlugins` is overridden with a pass-through. Every
 *     `.extend()` level without its own copy inherits CodeBlockLowlight's,
 *     whose `this.parent` call then runs it once per level: this extension
 *     and the three wrappers `sourceLineNodes.ts` adds made five lowlight
 *     highlighters, each decorating every code block on every load (#1565).
 *     Levels above now inherit this pass-through, which adds nothing.
 *
 * Known limitations:
 *   - Line numbers are recounted on every DOM mutation (no incremental update)
 *
 * @coordinates-with components/Editor/TiptapEditor.tsx — shows the gutter with the `show-line-numbers` class, from markdown.codeBlockLineNumbers
 * @coordinates-with plugins/codeBlockLineNumbers/languages — language registry + lowlight setup
 * @coordinates-with plugins/codeBlockLineNumbers/dropdown — dropdown controller
 * @module plugins/codeBlockLineNumbers/tiptap
 */
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { CodeBlockNodeView } from "./nodeView";
import { lowlight } from "./languages";
import "./code-block-line-numbers.css";
import "./hljs-syntax.css";

/**
 * Extended CodeBlockLowlight with line numbers, a copy button, and a language
 * selector dropdown. `defaultLanguage: "plaintext"` is load-bearing — without
 * it, `@tiptap/extension-code-block-lowlight` invokes `lowlight.highlightAuto`
 * on empty-language blocks and frequently mis-detects English prose as VB.NET.
 */
export const CodeBlockWithLineNumbers = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      meta: { default: null, rendered: false, parseHTML: () => null },
    };
  },
  addNodeView() {
    return ({ node, editor, getPos }) =>
      new CodeBlockNodeView(node, editor, getPos as () => number | undefined);
  },
  addProseMirrorPlugins() {
    return this.parent?.() ?? [];
  },
}).configure({ lowlight, defaultLanguage: "plaintext" });
