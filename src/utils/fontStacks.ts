/**
 * Font Stacks
 *
 * Purpose: Pure font-family stack definitions and resolution for the editor's
 *   `--font-sans` / `--font-mono` design tokens. No DOM access, no store
 *   imports — leaf-pure per ADR-013 (`src/utils/`).
 *
 * Key decisions:
 *   - Latin, CJK, and mono families each carry a system fallback.
 *   - The sans stack is `<latin>, <cjk>`; the Latin stack's trailing generic
 *     family is stripped first so CJK glyph resolution actually reaches the CJK
 *     fonts (issue #1056).
 *
 * @coordinates-with hooks/useTheme.ts — consumes these to emit CSS vars
 * @coordinates-with components/Terminal/terminalSessionStoreSync.ts — live mono sync
 * @module utils/fontStacks
 */

export const fontStacks = {
  latin: {
    system: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    athelas: "Athelas, Georgia, serif", // Apple Books default
    palatino: "Palatino, 'Palatino Linotype', serif",
    georgia: "Georgia, 'Times New Roman', serif",
    charter: "Charter, Georgia, serif",
    literata: "Literata, Georgia, serif", // Google reading font
  },
  cjk: {
    system: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    pingfang: '"PingFang SC", "PingFang TC", sans-serif', // Apple Books
    songti: '"Songti SC", "STSong", "SimSun", serif',
    kaiti: '"Kaiti SC", "STKaiti", "KaiTi", serif',
    notoserif: '"Noto Serif CJK SC", "Source Han Serif SC", serif',
    sourcehans: '"Source Han Sans SC", "Noto Sans CJK SC", sans-serif',
  },
  mono: {
    system: 'ui-monospace, "SF Mono", Menlo, Monaco, monospace',
    // macOS system fonts
    sfmono: '"SF Mono", ui-monospace, monospace',
    monaco: 'Monaco, ui-monospace, monospace',
    menlo: 'Menlo, ui-monospace, monospace',
    // Cross-platform
    consolas: 'Consolas, "Courier New", monospace',
    // Popular coding fonts (Nerd Font versions for terminal icon support)
    jetbrains: '"JetBrains Mono", ui-monospace, monospace',
    firacode: '"Fira Code", ui-monospace, monospace',
    saucecodepro: '"SauceCodePro Nerd Font Mono", "SauceCodePro NFM", ui-monospace, monospace',
    ibmplexmono: '"IBM Plex Mono", ui-monospace, monospace',
    hack: 'Hack, ui-monospace, monospace',
    inconsolata: 'Inconsolata, ui-monospace, monospace',
  },
};

/**
 * Resolve the monospace font stack for a given `monoFont` setting key. Pure —
 * no DOM access. This is the same mapping `buildFontStack` applies to the
 * editor's `--font-mono`, exposed on its own so the live terminal-font sync can
 * read the new font straight from the setting instead of round-tripping through
 * the CSS var (which `useTheme` only writes in a later effect).
 */
export function resolveMonoFontStack(monoFont: string): string {
  return (
    fontStacks.mono[monoFont as keyof typeof fontStacks.mono] ||
    fontStacks.mono.system
  );
}

/**
 * CSS generic font families. When one of these terminates a stack, the browser
 * stops glyph resolution there — it never falls through to a later named font.
 */
const GENERIC_FONT_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "system-ui",
  "cursive",
  "fantasy",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
]);

/**
 * Drop trailing generic families from a font stack.
 *
 * Issue #1056: the sans stack is `<latin>, <cjk>`. The Latin sub-stacks all end
 * in a generic family (e.g. `Athelas, Georgia, serif`). Because that generic
 * sits *before* the CJK fonts, the browser resolves CJK glyphs against the
 * system serif/sans-serif and never reaches the CJK stack — so the CJK Font
 * setting has no effect, and the Latin Font setting bleeds its serif/sans-serif
 * category onto CJK text. Stripping the Latin stack's trailing generic lets the
 * CJK fonts (and the CJK stack's own trailing generic, kept as the final
 * fallback) take effect. Always keeps at least one named family.
 */
function stripTrailingGenerics(stack: string): string {
  const parts = stack.split(",").map((p) => p.trim());
  while (
    parts.length > 1 &&
    GENERIC_FONT_FAMILIES.has(parts[parts.length - 1].toLowerCase())
  ) {
    parts.pop();
  }
  return parts.join(", ");
}

/** Build font stacks from font key selections. Pure — no DOM access. */
export function buildFontStack(
  latinFont: string,
  cjkFont: string,
  monoFont: string
): { sans: string; mono: string } {
  const latinStack =
    fontStacks.latin[latinFont as keyof typeof fontStacks.latin] ||
    fontStacks.latin.system;
  const cjkStack =
    fontStacks.cjk[cjkFont as keyof typeof fontStacks.cjk] ||
    fontStacks.cjk.system;
  const monoStack =
    fontStacks.mono[monoFont as keyof typeof fontStacks.mono] ||
    fontStacks.mono.system;

  // Strip the Latin stack's trailing generic so CJK glyph resolution reaches
  // the CJK stack (#1056). The CJK stack keeps its own trailing generic, which
  // becomes the overall fallback.
  return {
    sans: `${stripTrailingGenerics(latinStack)}, ${cjkStack}`,
    mono: monoStack,
  };
}
