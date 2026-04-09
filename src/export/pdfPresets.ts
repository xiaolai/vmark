/**
 * PDF Export Style Presets and Option Definitions
 *
 * Named style presets that bundle typography and margin settings into one-click choices.
 * Also contains all Select option definitions for the PDF settings sidebar.
 *
 * Option builders that need translation accept a `t` function from the "export" i18n
 * namespace. Options with universal labels (font names, sizes, values) are static constants.
 *
 * @module export/pdfPresets
 * @coordinates-with PdfSettingsSidebar.tsx — consumes presets and options
 * @coordinates-with pdfHtmlTemplate.ts — PdfOptions type, MARGIN_PRESETS
 * @coordinates-with locales/en/export.json — i18n keys for translatable labels
 */

import type { PdfOptions } from "./pdfHtmlTemplate";
import { MARGIN_PRESETS } from "./pdfHtmlTemplate";

/** Translation function signature (matches react-i18next `t`). */
type TFn = (key: string) => string;

// --- Style presets ---

/** A named style preset bundling typography and margin settings for PDF export. */
export interface StylePreset {
  /** i18n key for the preset label (resolved at render time). */
  labelKey: string;
  fontSize: number;
  lineHeight: number;
  latinFont: string;
  cjkFont: string;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
}

/** Built-in style presets: Default, Academic, Compact, and Elegant. */
export const STYLE_PRESETS: Record<string, StylePreset> = {
  default: {
    labelKey: "pdf.preset.default",
    fontSize: 11, lineHeight: 1.6,
    latinFont: "system", cjkFont: "system",
    marginTop: 25.4, marginRight: 25.4, marginBottom: 25.4, marginLeft: 25.4,
  },
  academic: {
    labelKey: "pdf.preset.academic",
    fontSize: 12, lineHeight: 2.0,
    latinFont: "palatino", cjkFont: "songti",
    marginTop: 25.4, marginRight: 38.1, marginBottom: 25.4, marginLeft: 38.1,
  },
  compact: {
    labelKey: "pdf.preset.compact",
    fontSize: 10, lineHeight: 1.4,
    latinFont: "system", cjkFont: "system",
    marginTop: 12.7, marginRight: 12.7, marginBottom: 12.7, marginLeft: 12.7,
  },
  elegant: {
    labelKey: "pdf.preset.elegant",
    fontSize: 12, lineHeight: 1.8,
    latinFont: "athelas", cjkFont: "kaiti",
    marginTop: 25.4, marginRight: 25.4, marginBottom: 25.4, marginLeft: 25.4,
  },
};

/** Build select options for the style preset dropdown (includes "Custom"). */
export function buildStylePresetOptions(t: TFn) {
  return [
    ...Object.entries(STYLE_PRESETS).map(([value, p]) => ({ value, label: t(p.labelKey) })),
    { value: "custom", label: t("pdf.preset.custom") },
  ];
}

// --- Preset detection ---

/** Detect which margin preset matches, or "custom". */
export function detectMarginPreset(options: PdfOptions): string {
  for (const [name, p] of Object.entries(MARGIN_PRESETS)) {
    if (
      options.marginTop === p.top &&
      options.marginRight === p.right &&
      options.marginBottom === p.bottom &&
      options.marginLeft === p.left
    ) return name;
  }
  return "custom";
}

/** Detect which style preset matches, or "custom". */
export function detectStylePreset(options: PdfOptions): string {
  for (const [name, p] of Object.entries(STYLE_PRESETS)) {
    if (
      options.fontSize === p.fontSize &&
      options.lineHeight === p.lineHeight &&
      options.latinFont === p.latinFont &&
      options.cjkFont === p.cjkFont &&
      options.marginTop === p.marginTop &&
      options.marginRight === p.marginRight &&
      options.marginBottom === p.marginBottom &&
      options.marginLeft === p.marginLeft
    ) return name;
  }
  return "custom";
}

// --- Select option arrays ---

/** Select options for page size (A4, Letter, A3, Legal). Universal labels — no translation needed. */
export const PAGE_SIZE_OPTIONS = [
  { value: "a4" as const, label: "A4" },
  { value: "letter" as const, label: "Letter" },
  { value: "a3" as const, label: "A3" },
  { value: "legal" as const, label: "Legal" },
];

/** Build select options for page orientation. */
export function buildOrientationOptions(t: TFn) {
  return [
    { value: "portrait" as const, label: t("pdf.pageSetup.orientation.portrait") },
    { value: "landscape" as const, label: t("pdf.pageSetup.orientation.landscape") },
  ];
}

/** Build select options for margin presets (Normal, Narrow, Wide, Custom). */
export function buildMarginPresetOptions(t: TFn) {
  return [
    { value: "normal", label: t("pdf.pageSetup.margins.normal") },
    { value: "narrow", label: t("pdf.pageSetup.margins.narrow") },
    { value: "wide", label: t("pdf.pageSetup.margins.wide") },
    { value: "custom", label: t("pdf.pageSetup.margins.custom") },
  ];
}

/** Select options for font size (10pt to 14pt). Universal labels — no translation needed. */
export const FONT_SIZE_OPTIONS = [
  { value: "10", label: "10pt" },
  { value: "11", label: "11pt" },
  { value: "12", label: "12pt" },
  { value: "13", label: "13pt" },
  { value: "14", label: "14pt" },
];

/** Select options for line height. Universal labels — no translation needed. */
export const LINE_HEIGHT_OPTIONS = [
  { value: "1.4", label: "1.4" },
  { value: "1.6", label: "1.6" },
  { value: "1.8", label: "1.8" },
  { value: "2.0", label: "2.0" },
];

/** Build select options for CJK inter-character spacing. */
export function buildCjkSpacingOptions(t: TFn) {
  return [
    { value: "0", label: t("pdf.typography.cjkSpacing.off") },
    { value: "0.02", label: "0.02em" },
    { value: "0.05", label: "0.05em" },
    { value: "0.08", label: "0.08em" },
  ];
}

/** Build select options for Latin font family. */
export function buildLatinFontOptions(t: TFn) {
  return [
    { value: "system", label: t("pdf.typography.font.systemDefault") },
    { value: "athelas", label: "Athelas" },
    { value: "palatino", label: "Palatino" },
    { value: "georgia", label: "Georgia" },
    { value: "charter", label: "Charter" },
  ];
}

/** Build select options for CJK font family. */
export function buildCjkFontOptions(t: TFn) {
  return [
    { value: "system", label: t("pdf.typography.font.systemDefault") },
    { value: "pingfang", label: "PingFang SC" },
    { value: "songti", label: "Songti SC" },
    { value: "kaiti", label: "Kaiti SC" },
    { value: "notoserif", label: "Noto Serif CJK" },
  ];
}
