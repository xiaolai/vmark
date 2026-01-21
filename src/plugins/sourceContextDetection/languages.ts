/**
 * Language Data for Code Fence Picker
 *
 * Provides language list with aliases for search/filtering.
 */

export interface Language {
  name: string;
  aliases: string[];
}

/**
 * Quick access languages shown as buttons.
 */
export const QUICK_LANGUAGES: Language[] = [
  { name: "javascript", aliases: ["js"] },
  { name: "typescript", aliases: ["ts"] },
  { name: "python", aliases: ["py"] },
  { name: "rust", aliases: ["rs"] },
  { name: "go", aliases: ["golang"] },
];

/**
 * All supported languages with aliases.
 * Sorted alphabetically by name.
 */
export const LANGUAGES: Language[] = [
  { name: "abap", aliases: [] },
  { name: "apex", aliases: [] },
  { name: "applescript", aliases: [] },
  { name: "asm", aliases: ["assembly", "nasm"] },
  { name: "astro", aliases: [] },
  { name: "awk", aliases: [] },
  { name: "bash", aliases: ["sh", "shell", "zsh", "fish"] },
  { name: "batch", aliases: ["bat", "cmd"] },
  { name: "c", aliases: [] },
  { name: "clojure", aliases: ["clj"] },
  { name: "cmake", aliases: [] },
  { name: "cobol", aliases: [] },
  { name: "coffeescript", aliases: ["coffee"] },
  { name: "cpp", aliases: ["c++", "cxx"] },
  { name: "crystal", aliases: ["cr"] },
  { name: "csharp", aliases: ["c#", "cs"] },
  { name: "css", aliases: [] },
  { name: "csv", aliases: [] },
  { name: "cuda", aliases: ["cu"] },
  { name: "d", aliases: ["dlang"] },
  { name: "dart", aliases: [] },
  { name: "diff", aliases: ["patch"] },
  { name: "dockerfile", aliases: ["docker"] },
  { name: "elixir", aliases: ["ex", "exs"] },
  { name: "elm", aliases: [] },
  { name: "erlang", aliases: ["erl"] },
  { name: "fortran", aliases: ["f90", "f95"] },
  { name: "fsharp", aliases: ["f#", "fs"] },
  { name: "gherkin", aliases: ["cucumber", "feature"] },
  { name: "git", aliases: ["gitignore", "gitconfig"] },
  { name: "glsl", aliases: ["shader"] },
  { name: "go", aliases: ["golang"] },
  { name: "graphql", aliases: ["gql"] },
  { name: "groovy", aliases: [] },
  { name: "haml", aliases: [] },
  { name: "handlebars", aliases: ["hbs"] },
  { name: "haskell", aliases: ["hs"] },
  { name: "hcl", aliases: ["terraform", "tf"] },
  { name: "html", aliases: ["htm"] },
  { name: "http", aliases: [] },
  { name: "ini", aliases: ["conf", "config"] },
  { name: "java", aliases: [] },
  { name: "javascript", aliases: ["js", "jsx"] },
  { name: "jinja", aliases: ["jinja2"] },
  { name: "json", aliases: ["jsonc"] },
  { name: "jsonnet", aliases: [] },
  { name: "julia", aliases: ["jl"] },
  { name: "kotlin", aliases: ["kt", "kts"] },
  { name: "latex", aliases: ["tex"] },
  { name: "less", aliases: [] },
  { name: "lisp", aliases: ["elisp", "emacs-lisp"] },
  { name: "llvm", aliases: [] },
  { name: "log", aliases: [] },
  { name: "lua", aliases: [] },
  { name: "makefile", aliases: ["make"] },
  { name: "markdown", aliases: ["md", "mdx"] },
  { name: "matlab", aliases: ["octave"] },
  { name: "mermaid", aliases: [] },
  { name: "nginx", aliases: [] },
  { name: "nim", aliases: [] },
  { name: "nix", aliases: [] },
  { name: "objectivec", aliases: ["objc", "obj-c"] },
  { name: "ocaml", aliases: ["ml"] },
  { name: "pascal", aliases: ["delphi"] },
  { name: "perl", aliases: ["pl"] },
  { name: "php", aliases: [] },
  { name: "plaintext", aliases: ["text", "txt"] },
  { name: "plsql", aliases: [] },
  { name: "postcss", aliases: [] },
  { name: "powershell", aliases: ["ps1", "pwsh"] },
  { name: "prisma", aliases: [] },
  { name: "prolog", aliases: [] },
  { name: "properties", aliases: [] },
  { name: "protobuf", aliases: ["proto"] },
  { name: "pug", aliases: ["jade"] },
  { name: "python", aliases: ["py", "python3"] },
  { name: "r", aliases: [] },
  { name: "razor", aliases: ["cshtml"] },
  { name: "regex", aliases: ["regexp"] },
  { name: "ruby", aliases: ["rb"] },
  { name: "rust", aliases: ["rs"] },
  { name: "scala", aliases: [] },
  { name: "scheme", aliases: ["scm"] },
  { name: "scss", aliases: ["sass"] },
  { name: "shell", aliases: [] },
  { name: "smalltalk", aliases: ["st"] },
  { name: "solidity", aliases: ["sol"] },
  { name: "sparql", aliases: [] },
  { name: "sql", aliases: ["mysql", "postgresql", "sqlite"] },
  { name: "stylus", aliases: ["styl"] },
  { name: "svelte", aliases: [] },
  { name: "swift", aliases: [] },
  { name: "tcl", aliases: [] },
  { name: "toml", aliases: [] },
  { name: "tsx", aliases: [] },
  { name: "twig", aliases: [] },
  { name: "typescript", aliases: ["ts"] },
  { name: "vb", aliases: ["vbnet", "visualbasic"] },
  { name: "verilog", aliases: ["v"] },
  { name: "vhdl", aliases: [] },
  { name: "vim", aliases: ["viml", "vimscript"] },
  { name: "vue", aliases: [] },
  { name: "wasm", aliases: ["webassembly", "wat"] },
  { name: "xml", aliases: ["xsl", "xslt", "svg"] },
  { name: "yaml", aliases: ["yml"] },
  { name: "zig", aliases: [] },
];

/**
 * Get display label for quick button (uppercase abbreviation).
 */
export function getQuickLabel(name: string): string {
  const labels: Record<string, string> = {
    javascript: "JS",
    typescript: "TS",
    python: "PY",
    rust: "RS",
    go: "GO",
  };
  return labels[name] || name.toUpperCase().slice(0, 2);
}

/**
 * Filter languages by search query.
 * Matches name or any alias.
 */
export function filterLanguages(query: string): Language[] {
  if (!query) return LANGUAGES;

  const lower = query.toLowerCase();
  return LANGUAGES.filter(
    (lang) =>
      lang.name.toLowerCase().includes(lower) ||
      lang.aliases.some((alias) => alias.toLowerCase().includes(lower))
  );
}

// Recent languages storage
const STORAGE_KEY = "vmark:recent-languages";
const MAX_RECENT = 5;

/**
 * Get recently used languages from localStorage.
 */
export function getRecentLanguages(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Add a language to recent history.
 */
export function addRecentLanguage(lang: string): void {
  const recent = getRecentLanguages();
  const updated = [lang, ...recent.filter((l) => l !== lang)].slice(
    0,
    MAX_RECENT
  );
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore localStorage errors
  }
}
