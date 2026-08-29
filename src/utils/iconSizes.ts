/**
 * Purpose: the sanctioned lucide glyph sizes (WI-UI2.3, C7).
 *
 * Every `<Icon size={…}>` in chrome draws at one of these four sizes; the
 * ui-consistency gate (C7) fails on any other number. Named constants exist so
 * a call site can say what it means (`ICON_SM`) instead of restating a magic
 * number the gate happens to accept.
 *
 * 14 (`ICON_SM`) is also what `.vm-icon-btn`'s stylesheet forces on svg
 * children — passing another size inside that primitive is dead code.
 *
 * @module utils/iconSizes
 */
export const ICON_XS = 12;
export const ICON_SM = 14;
export const ICON_MD = 16;
export const ICON_LG = 18;

export const ICON_SIZES: ReadonlySet<number> = new Set([ICON_XS, ICON_SM, ICON_MD, ICON_LG]);
