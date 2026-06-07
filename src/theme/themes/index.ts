/**
 * Theme catalog — barrel.
 *
 * After theme-unification-2026-05 this is the single source of truth for
 * vmark's theme definitions. `settingsStore.themes` re-exports from here.
 *
 * Adding a theme:
 *   1. Add `src/theme/themes/<name>.ts` exporting a `ThemeTokens` value.
 *   2. Append the name to the `themes` map below.
 *
 * `ThemeId` is derived from `themes` (single source of truth — see below);
 * `settingsTypes.ts` imports it, so there is no second union to keep in sync.
 *
 * Nothing else in the codebase should need editing.
 *
 * @module theme/themes
 */

import type { ThemeTokens } from "../tokens";
import { paper } from "./paper";
import { white } from "./white";
import { mint } from "./mint";
import { sepia } from "./sepia";
import { night } from "./night";
import { solarized } from "./solarized";


export const themes = {
  white,
  paper,
  mint,
  sepia,
  night,
  solarized,
} satisfies Record<string, ThemeTokens>;

// audit-fix — single-source ThemeId
/** Available theme identifiers — derived from the `themes` catalog so the
 *  union can never drift from the registered set. `settingsTypes.ts` imports
 *  this instead of redeclaring the union. */
export type ThemeId = keyof typeof themes;
