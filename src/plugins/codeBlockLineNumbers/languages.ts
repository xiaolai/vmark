/**
 * Language registry for the WYSIWYG code block.
 *
 * Owns two responsibilities:
 *   1. The list of language ids exposed in the dropdown (`LANGUAGES`).
 *   2. The lowlight instance used by `CodeBlockLowlight`.
 *
 * Why `common` + selective imports (not `all`):
 *   `lowlight/lib/common` ships ~37 grammars covering the 80% case while
 *   keeping the bundle small. The dropdown also exposes 12 less-common ids
 *   (Scala, PowerShell, Dockerfile, Haskell, Elixir, Clojure, Erlang, OCaml,
 *   F#, Dart, MATLAB, LaTeX); we register those individually from
 *   `highlight.js/lib/languages/*` so every dropdown id resolves to a real
 *   grammar without dragging in the full ~195-grammar `all` set (~+730 kB on
 *   the EAGER:App chunk). This protects the cold-start budget pinned in
 *   `.size-limit.cjs` while keeping the dropdown fully functional.
 *
 * Why `defaultLanguage: "plaintext"` matters:
 *   Without a default, `@tiptap/extension-code-block-lowlight` calls
 *   `lowlight.highlightAuto()` on empty-language blocks. Auto-detect
 *   frequently picks VB.NET on English prose; VB.NET's `'` line-comment rule
 *   wraps the rest of each paragraph in `<span class="hljs-comment">`, which
 *   `hljs-syntax.css` styles `font-style: italic`. Routing empty-language
 *   blocks to `plaintext` makes them inert.
 *
 * @module plugins/codeBlockLineNumbers/languages
 */
import { common, createLowlight } from "lowlight";
import clojure from "highlight.js/lib/languages/clojure";
import dart from "highlight.js/lib/languages/dart";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import elixir from "highlight.js/lib/languages/elixir";
import erlang from "highlight.js/lib/languages/erlang";
import fsharp from "highlight.js/lib/languages/fsharp";
import haskell from "highlight.js/lib/languages/haskell";
import latex from "highlight.js/lib/languages/latex";
import matlab from "highlight.js/lib/languages/matlab";
import ocaml from "highlight.js/lib/languages/ocaml";
import powershell from "highlight.js/lib/languages/powershell";
import scala from "highlight.js/lib/languages/scala";

export const lowlight = createLowlight(common);

lowlight.register({
  clojure,
  dart,
  dockerfile,
  elixir,
  erlang,
  fsharp,
  haskell,
  latex,
  matlab,
  ocaml,
  powershell,
  scala,
});

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
