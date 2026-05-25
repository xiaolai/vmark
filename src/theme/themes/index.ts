/**
 * Theme catalog — barrel.
 *
 * After theme-unification-2026-05 this is the single source of truth for
 * vmark's theme definitions. `settingsStore.themes` re-exports from here.
 *
 * Adding a theme:
 *   1. Add `src/theme/themes/<name>.ts` exporting a `ThemeTokens` value.
 *   2. Append the name to the `themes` map below.
 *   3. Add the ID to `ThemeId` in `settingsTypes.ts`.
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

export { paper, white, mint, sepia, night };

export type ThemeId = "white" | "paper" | "mint" | "sepia" | "night";

export const themes: Record<ThemeId, ThemeTokens> = {
  white,
  paper,
  mint,
  sepia,
  night,
};
