// @vitest-environment node
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
import { FONT_OPTIONS } from "@/utils/fontOptions";
import { fontStacks } from "@/utils/fontStacks";
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

/**
 * #1429 — the PDF sidebar carried its OWN hand-written font lists, four Latin
 * families against Settings' six. The dialog seeds its fonts from the app's
 * appearance settings, so an editor set to Literata or Source Han Sans opened
 * it with a BLANK select over a perfectly correct value. Both lists now come
 * from the one curated table, and the current value is always present.
 */
describe("PDF font options cover every value the dialog can be seeded with", () => {
  it("offers the same Latin families Settings does", () => {
    const values = buildLatinFontOptions(mockT).map((o) => o.value);
    expect(values).toEqual(FONT_OPTIONS.latin.map((o) => o.value));
  });

  it("offers the same CJK families Settings does", () => {
    const values = buildCjkFontOptions(mockT).map((o) => o.value);
    expect(values).toEqual(FONT_OPTIONS.cjk.map((o) => o.value));
  });

  it("appends a custom family so the select is never blank", () => {
    const options = buildCjkFontOptions(mockT, "custom:LXGW WenKai");
    expect(options).toContainEqual({ value: "custom:LXGW WenKai", label: "LXGW WenKai" });
  });

  it("does not append a curated value that is already listed", () => {
    const options = buildLatinFontOptions(mockT, "athelas");
    expect(options.filter((o) => o.value === "athelas")).toHaveLength(1);
  });

  it("ignores a current value that is not usable", () => {
    const options = buildLatinFontOptions(mockT, 'custom:X"; color: red');
    expect(options.map((o) => o.value)).toEqual(FONT_OPTIONS.latin.map((o) => o.value));
  });

  it("is unchanged when no current value is given", () => {
    expect(buildLatinFontOptions(mockT)).toEqual(buildLatinFontOptions(mockT, "system"));
  });
});

/**
 * Every curated key must resolve to a real stack. A key with no entry falls
 * back to `system` SILENTLY, which is how a picker offers a font that does
 * nothing (#1429).
 */
describe("every curated font key resolves", () => {
  it("resolves each Latin and CJK key to a distinct stack", () => {
    for (const { value } of FONT_OPTIONS.latin) {
      expect(fontStacks.latin).toHaveProperty(value);
    }
    for (const { value } of FONT_OPTIONS.cjk) {
      expect(fontStacks.cjk).toHaveProperty(value);
    }
    for (const { value } of FONT_OPTIONS.mono) {
      expect(fontStacks.mono).toHaveProperty(value);
    }
  });
});
