/**
 * Tests for pdfPresets option builders and detection functions.
 *
 * Verifies that builder functions correctly resolve i18n keys via the
 * provided translation function.
 */

import { describe, it, expect } from "vitest";
import {
  buildStylePresetOptions,
  buildOrientationOptions,
  buildMarginPresetOptions,
  buildCjkSpacingOptions,
  buildLatinFontOptions,
  buildCjkFontOptions,
  detectStylePreset,
  detectMarginPreset,
  STYLE_PRESETS,
} from "../pdfPresets";
import type { PdfOptions } from "../pdfHtmlTemplate";

/** Mock translation function — returns the key's last segment for easy assertion. */
const mockT = (key: string) => key;

function createDefaultOptions(): PdfOptions {
  return {
    pageSize: "a4",
    orientation: "portrait",
    marginTop: 25.4,
    marginRight: 25.4,
    marginBottom: 25.4,
    marginLeft: 25.4,
    showPageNumbers: true,
    showHeader: true,
    showDate: false,
    title: "Test",
    fontSize: 11,
    lineHeight: 1.6,
    cjkLetterSpacing: "0.05em",
    latinFont: "system",
    cjkFont: "system",
    useEditorTheme: false,
  };
}

describe("pdfPresets option builders", () => {
  it("buildStylePresetOptions includes all presets plus Custom", () => {
    const options = buildStylePresetOptions(mockT);
    expect(options).toHaveLength(Object.keys(STYLE_PRESETS).length + 1);
    expect(options.at(-1)).toEqual({ value: "custom", label: "pdf.preset.custom" });
    // First preset should use the labelKey
    expect(options[0].label).toBe("pdf.preset.default");
  });

  it("buildOrientationOptions returns portrait and landscape", () => {
    const options = buildOrientationOptions(mockT);
    expect(options).toHaveLength(2);
    expect(options[0].value).toBe("portrait");
    expect(options[1].value).toBe("landscape");
  });

  it("buildMarginPresetOptions returns 4 options", () => {
    const options = buildMarginPresetOptions(mockT);
    expect(options).toHaveLength(4);
    const values = options.map((o) => o.value);
    expect(values).toEqual(["normal", "narrow", "wide", "custom"]);
  });

  it("buildCjkSpacingOptions translates 'Off' and keeps numeric labels", () => {
    const options = buildCjkSpacingOptions(mockT);
    expect(options[0]).toEqual({ value: "0", label: "pdf.typography.cjkSpacing.off" });
    expect(options[1]).toEqual({ value: "0.02", label: "0.02em" });
  });

  it("buildLatinFontOptions translates 'System Default' and keeps font names", () => {
    const options = buildLatinFontOptions(mockT);
    expect(options[0]).toEqual({ value: "system", label: "pdf.typography.font.systemDefault" });
    expect(options[1]).toEqual({ value: "athelas", label: "Athelas" });
  });

  it("buildCjkFontOptions translates 'System Default' and keeps font names", () => {
    const options = buildCjkFontOptions(mockT);
    expect(options[0]).toEqual({ value: "system", label: "pdf.typography.font.systemDefault" });
    expect(options[1]).toEqual({ value: "pingfang", label: "PingFang SC" });
  });
});

describe("pdfPresets detection functions", () => {
  it("detectStylePreset returns 'default' for default options", () => {
    expect(detectStylePreset(createDefaultOptions())).toBe("default");
  });

  it("detectStylePreset returns 'custom' for non-matching options", () => {
    const opts = { ...createDefaultOptions(), fontSize: 99 };
    expect(detectStylePreset(opts)).toBe("custom");
  });

  it("detectMarginPreset returns 'normal' for 25.4mm all sides", () => {
    expect(detectMarginPreset(createDefaultOptions())).toBe("normal");
  });

  it("detectMarginPreset returns 'narrow' for 12.7mm all sides", () => {
    const opts = { ...createDefaultOptions(), marginTop: 12.7, marginRight: 12.7, marginBottom: 12.7, marginLeft: 12.7 };
    expect(detectMarginPreset(opts)).toBe("narrow");
  });

  it("detectMarginPreset returns 'custom' for non-matching margins", () => {
    const opts = { ...createDefaultOptions(), marginTop: 99 };
    expect(detectMarginPreset(opts)).toBe("custom");
  });
});
