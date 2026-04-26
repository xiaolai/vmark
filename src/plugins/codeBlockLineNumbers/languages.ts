/**
 * Language registry for the WYSIWYG code block.
 *
 * Owns two responsibilities:
 *   1. The list of language ids exposed in the dropdown (`LANGUAGES`).
 *   2. The lowlight instance used by `CodeBlockLowlight`.
 *
 * Why `all` and not `common`:
 *   `lowlight/lib/common` only ships ~37 grammars — Scala, PowerShell,
 *   Dockerfile, Haskell, Elixir, Clojure, Erlang, OCaml, F#, Dart, MATLAB and
 *   LaTeX are all absent. With those ids exposed in the dropdown, picking one
 *   would silently fall through to `lowlight.highlightAuto()`, which
 *   frequently mis-detects English prose as VB.NET and italicizes apostrophe
 *   contractions via the `hljs-comment` rule. Using `all` registers every
 *   grammar shipped by highlight.js so every dropdown id has a real grammar.
 *
 * @module plugins/codeBlockLineNumbers/languages
 */
import { all, createLowlight } from "lowlight";

export const lowlight = createLowlight(all);

export interface LanguageEntry {
  /** lowlight/highlight.js language id (or alias) */
  id: string;
  /** Human-readable display name */
  name: string;
}

/**
 * Languages offered by the WYSIWYG dropdown. `plaintext` leads so it appears
 * first when the user opens the dropdown on a fresh (empty-language) block —
 * this is the default state and was historically the top entry; the rest are
 * ordered roughly by popularity.
 *
 * Every id MUST be either present in `lowlight.listLanguages()` or registered
 * as an alias of a grammar in that list (e.g. `html` → `xml`). This is
 * enforced by `__tests__/languages.registry.test.ts`.
 */
export const LANGUAGES: readonly LanguageEntry[] = [
  { id: "plaintext", name: "Plain Text" },
  { id: "javascript", name: "JavaScript" },
  { id: "typescript", name: "TypeScript" },
  { id: "python", name: "Python" },
  { id: "java", name: "Java" },
  { id: "c", name: "C" },
  { id: "cpp", name: "C++" },
  { id: "csharp", name: "C#" },
  { id: "go", name: "Go" },
  { id: "rust", name: "Rust" },
  { id: "ruby", name: "Ruby" },
  { id: "php", name: "PHP" },
  { id: "swift", name: "Swift" },
  { id: "kotlin", name: "Kotlin" },
  { id: "scala", name: "Scala" },
  { id: "html", name: "HTML" },
  { id: "css", name: "CSS" },
  { id: "scss", name: "SCSS" },
  { id: "json", name: "JSON" },
  { id: "yaml", name: "YAML" },
  { id: "xml", name: "XML" },
  { id: "markdown", name: "Markdown" },
  { id: "sql", name: "SQL" },
  { id: "shell", name: "Shell" },
  { id: "bash", name: "Bash" },
  { id: "powershell", name: "PowerShell" },
  { id: "dockerfile", name: "Dockerfile" },
  { id: "graphql", name: "GraphQL" },
  { id: "lua", name: "Lua" },
  { id: "r", name: "R" },
  { id: "perl", name: "Perl" },
  { id: "haskell", name: "Haskell" },
  { id: "elixir", name: "Elixir" },
  { id: "clojure", name: "Clojure" },
  { id: "erlang", name: "Erlang" },
  { id: "ocaml", name: "OCaml" },
  { id: "fsharp", name: "F#" },
  { id: "dart", name: "Dart" },
  { id: "objectivec", name: "Objective-C" },
  { id: "matlab", name: "MATLAB" },
  { id: "latex", name: "LaTeX" },
  { id: "diff", name: "Diff" },
];
