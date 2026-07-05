/**
 * Diagram Theme Tokens
 *
 * Purpose: Single reader for the design tokens diagram renderers (Mermaid,
 * Graphviz) need to produce theme-native output. Reads the live CSS custom
 * properties from documentElement so every theme — paper, white, mint, sepia,
 * night, solarized, and any future theme — Just Works without renderer-side
 * light/dark special cases.
 *
 * Key decisions:
 *   - Read order per token: computed style -> inline style -> light fallback.
 *     The inline fallback makes the helper testable in jsdom (where computed
 *     custom properties may be empty); the hardcoded fallbacks cover SSR/test
 *     environments with no tokens at all.
 *   - `isDark` is token-derived (background luminance) with the `.dark-theme`
 *     / `.dark` classes as a corroborating signal — dark is an outcome of the
 *     theme's tokens, not a separate mode.
 *   - Callers must invoke `readDiagramThemeTokens()` per render/initialize
 *     cycle; values are never captured at module load.
 *
 * @coordinates-with mermaid/themeConfig.ts — maps tokens to mermaid themeVariables
 * @coordinates-with graphviz/plugin.ts — maps tokens to Graphviz default attributes
 * @coordinates-with codePreview/themeObserver.ts — snapshot compare on theme change
 * @module plugins/shared/diagramThemeTokens
 */

export interface DiagramThemeTokens {
  bgColor: string;
  bgSecondary: string;
  textColor: string;
  textSecondary: string;
  borderColor: string;
  accentPrimary: string;
  mdCharColor: string;
  fontMono: string;
  /** Derived: dark class present or dark background luminance. */
  isDark: boolean;
}

/** Light-theme fallbacks for environments where tokens are unset (tests/SSR). */
const FALLBACKS = {
  "--bg-color": "#eeeded",
  "--bg-secondary": "#e5e4e4",
  "--text-color": "#1a1a1a",
  "--text-secondary": "#666666",
  "--border-color": "#d5d4d4",
  "--accent-primary": "#0066cc",
  "--md-char-color": "#777777",
  "--font-mono": 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
} as const;

type TokenName = keyof typeof FALLBACKS;

/** Parse `#rgb`, `#rrggbb`, `rgb()` or `rgba()` into [r, g, b] (0-255). */
function parseColor(color: string): [number, number, number] | null {
  const trimmed = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (hex) {
    const h = hex[1];
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(trimmed);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/**
 * True when `color` parses to a dark color (relative luminance < 0.5).
 * Unparseable colors (keywords, var() refs, empty) return false.
 */
export function isDarkColor(color: string): boolean {
  const rgb = parseColor(color);
  if (!rgb) return false;
  // Rec. 709 luma on gamma-encoded values — adequate for a dark/light split.
  const [r, g, b] = rgb;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

function readToken(root: HTMLElement, computed: CSSStyleDeclaration, name: TokenName): string {
  return (
    computed.getPropertyValue(name).trim() ||
    root.style.getPropertyValue(name).trim() ||
    FALLBACKS[name]
  );
}

/** Read the current diagram-relevant design tokens from documentElement. */
export function readDiagramThemeTokens(): DiagramThemeTokens {
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const bgColor = readToken(root, computed, "--bg-color");
  const hasDarkClass = root.classList.contains("dark-theme") || root.classList.contains("dark");
  return {
    bgColor,
    bgSecondary: readToken(root, computed, "--bg-secondary"),
    textColor: readToken(root, computed, "--text-color"),
    textSecondary: readToken(root, computed, "--text-secondary"),
    borderColor: readToken(root, computed, "--border-color"),
    accentPrimary: readToken(root, computed, "--accent-primary"),
    mdCharColor: readToken(root, computed, "--md-char-color"),
    fontMono: readToken(root, computed, "--font-mono"),
    isDark: hasDarkClass || isDarkColor(bgColor),
  };
}

/** Stable snapshot string for change detection (theme observer, config sync). */
export function serializeDiagramThemeTokens(tokens: DiagramThemeTokens): string {
  return [
    tokens.bgColor,
    tokens.bgSecondary,
    tokens.textColor,
    tokens.textSecondary,
    tokens.borderColor,
    tokens.accentPrimary,
    tokens.mdCharColor,
    tokens.fontMono,
    tokens.isDark ? "dark" : "light",
  ].join("|");
}
