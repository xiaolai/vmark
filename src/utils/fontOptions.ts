/**
 * Font Options — the CURATED pick-list behind each font setting.
 *
 * Purpose: the shortlist VMark recommends per role, kept in ONE place because
 * two surfaces render it — Settings and the PDF export sidebar. They used to
 * carry separate hand-written copies, and the copies had drifted: the PDF
 * sidebar listed four Latin families against Settings' six, so an editor set
 * to Literata or Source Han Sans opened the PDF dialog with a BLANK font
 * select over a value that was perfectly correct (#1429, found while adding
 * custom families — which would have widened the same hole).
 *
 * Labels are not translated: a font family name is a proper noun, and
 * "PingFang SC" is what the system calls it in every locale. `label: null`
 * means the system default, whose wording IS translated and is supplied by
 * the caller.
 *
 * The list stays a shortlist rather than the machine's whole font book: the
 * recommendation per role — a CJK face for CJK, a real monospace for code —
 * is the entire value of these entries on a machine with 300 families.
 * Everything else is reachable as a custom family.
 *
 * @coordinates-with utils/fontStacks.ts — every key here must resolve there
 * @coordinates-with pages/settings/FontSettings.tsx — the Settings rows
 * @coordinates-with export/pdfPresets.ts — the PDF sidebar's selects
 * @module utils/fontOptions
 */

/** The three font roles a document uses. */
export type FontRole = "latin" | "cjk" | "mono";

/** One curated entry: the stored key, and the family name to show for it. */
export interface FontOption {
  value: string;
  /** `null` = the system default; the caller supplies the translated wording. */
  label: string | null;
}

/** The curated shortlist per role. */
export const FONT_OPTIONS: Record<FontRole, readonly FontOption[]> = {
  latin: [
    { value: "system", label: null },
    { value: "athelas", label: "Athelas" },
    { value: "palatino", label: "Palatino" },
    { value: "georgia", label: "Georgia" },
    { value: "charter", label: "Charter" },
    { value: "literata", label: "Literata" },
  ],
  cjk: [
    { value: "system", label: null },
    { value: "pingfang", label: "PingFang SC" },
    { value: "songti", label: "Songti SC" },
    { value: "kaiti", label: "Kaiti SC" },
    { value: "notoserif", label: "Noto Serif CJK" },
    { value: "sourcehans", label: "Source Han Sans" },
  ],
  mono: [
    { value: "system", label: null },
    { value: "sfmono", label: "SF Mono" },
    { value: "monaco", label: "Monaco" },
    { value: "menlo", label: "Menlo" },
    { value: "consolas", label: "Consolas" },
    // Linux distribution defaults (#1334) — without these a Linux user had no
    // monospace family in the list that ships on their machine.
    { value: "dejavu", label: "DejaVu Sans Mono" },
    { value: "liberation", label: "Liberation Mono" },
    { value: "ubuntumono", label: "Ubuntu Mono" },
    { value: "notosansmono", label: "Noto Sans Mono" },
    { value: "notosansmonocjk", label: "Noto Sans Mono CJK SC" },
    { value: "jetbrains", label: "JetBrains Mono" },
    { value: "firacode", label: "Fira Code" },
    { value: "saucecodepro", label: "SauceCodePro NFM" },
    { value: "ibmplexmono", label: "IBM Plex Mono" },
    { value: "hack", label: "Hack" },
    { value: "inconsolata", label: "Inconsolata" },
  ],
};

