/**
 * CJK formatting settings types — quote styles, auto-pairing, and the
 * fine-grained CJK formatter toggles.
 *
 * Extracted from settingsTypes.ts, which remains the stable entry point.
 *
 * @module stores/settingsTypes/cjk
 */

// ---------------------------------------------------------------------------
// CJK
// ---------------------------------------------------------------------------

/** CJK bracket auto-pairing style: "off" disables, "auto" enables smart pairing. */
export type AutoPairCJKStyle = "off" | "auto";

// ---------------------------------------------------------------------------
// CJK Formatting
// ---------------------------------------------------------------------------

export type { CJKFormattingSettings, QuoteStyle } from "@/lib/cjkFormatter/types";
