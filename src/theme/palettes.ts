/**
 * Syntax and ANSI palette shapes — split out of `tokens.ts` (WI-UI2.3, the
 * 300-line gate). These are the two fixed-role color vocabularies inside
 * `ThemeTokens`; the contract itself stays in `theme/tokens.ts`.
 *
 * @module theme/palettes
 */

/** 16-role syntax palette (D11, WI-UI1.5). Emitted as `--syntax-<role>` by
 * `applyTheme`'s flatten and consumed by source-syntax.css, hljs-syntax.css
 * and json-view-theme.css. AUTHORED per theme (not derived from ANSI at
 * runtime — 17 of 42 ANSI-as-syntax candidates fail 4.5:1 because ANSI was
 * authored expecting xterm's contrast lift); every value clears 4.5:1 on
 * bg.primary AND bg.secondary, checked by check-theme-contrast C1e. */
export interface SyntaxPalette {
  keyword: string;
  type: string;
  function: string;
  property: string;
  variable: string;
  string: string;
  number: string;
  operator: string;
  punctuation: string;
  comment: string;
  escape: string;
  constant: string;
  attribute: string;
  tag: string;
  link: string;
  invalid: string;
}

/** 16-color ANSI palette consumed by the xterm.js terminal. */
export interface AnsiPalette {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}
