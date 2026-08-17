/**
 * PDF Export Settings Sidebar
 *
 * Settings panel for PDF export. Features:
 * - Style presets (Default/Academic/Compact/Elegant) at the top
 * - Page Setup section (always open)
 * - Typography section (collapsible)
 * - Appearance section (collapsible, "Use Editor Theme" toggle)
 * - Export button at the bottom
 *
 * @module export/PdfSettingsSidebar
 * @coordinates-with PdfExportDialog.tsx — parent component
 * @coordinates-with pdfPresets.ts — style presets and option definitions
 * @coordinates-with pdfHtmlTemplate.ts — PdfOptions type, MARGIN_PRESETS
 * @coordinates-with PdfSidebarPrimitives.tsx — the layout components below
 */

import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type PdfOptions, MARGIN_PRESETS } from "./pdfHtmlTemplate";
import {
  STYLE_PRESETS,
  buildStylePresetOptions,
  detectMarginPreset, detectStylePreset,
  PAGE_SIZE_OPTIONS,
  PAGE_NUMBER_POSITION_OPTIONS,
  PAGE_NUMBER_FORMAT_OPTIONS,
  buildOrientationOptions, buildMarginPresetOptions,
  FONT_SIZE_OPTIONS, LINE_HEIGHT_OPTIONS,
  buildCjkSpacingOptions, buildLatinFontOptions, buildCjkFontOptions,
} from "./pdfPresets";
import { FileText, Type, Palette, Hash } from "lucide-react";
import {
  SettingRow,
  Select,
  Toggle,
  Button,
} from "@/pages/settings/components";
import {
  PdfSettingsGroup,
  CollapsibleSection,
  MarginLayoutDiagram,
  type MarginSide,
} from "./PdfSidebarPrimitives";

// --- Main sidebar ---

interface PdfSettingsSidebarProps {
  options: PdfOptions;
  onOptionChange: <K extends keyof PdfOptions>(key: K, value: PdfOptions[K]) => void;
  onExport: () => void;
  exporting: boolean;
  exportStage: string;
}

/** Renders the PDF export settings sidebar with presets, page setup, typography, and headers. */
export function PdfSettingsSidebar({ options, onOptionChange: set, onExport, exporting, exportStage }: PdfSettingsSidebarProps) {
  const { t } = useTranslation("export");
  const [stylePreset, setStylePreset] = useState(() => detectStylePreset(options));
  const [marginPreset, setMarginPreset] = useState(() => detectMarginPreset(options));

  // Build translated select options (memoized to avoid re-creating on every render)
  const stylePresetOptions = useMemo(() => buildStylePresetOptions(t), [t]);
  const orientationOptions = useMemo(() => buildOrientationOptions(t), [t]);
  const marginPresetOptions = useMemo(() => buildMarginPresetOptions(t), [t]);
  const cjkSpacingOptions = useMemo(() => buildCjkSpacingOptions(t), [t]);
  const latinFontOptions = useMemo(() => buildLatinFontOptions(t), [t]);
  const cjkFontOptions = useMemo(() => buildCjkFontOptions(t), [t]);

  // Apply a style preset — sets fonts, sizes, margins in one click
  const handleStylePresetChange = useCallback((preset: string) => {
    setStylePreset(preset);
    const p = STYLE_PRESETS[preset];
    if (!p) return;
    set("fontSize", p.fontSize);
    set("lineHeight", p.lineHeight);
    set("latinFont", p.latinFont);
    set("cjkFont", p.cjkFont);
    set("marginTop", p.marginTop);
    set("marginRight", p.marginRight);
    set("marginBottom", p.marginBottom);
    set("marginLeft", p.marginLeft);
    // Also sync the margin preset dropdown
    setMarginPreset(detectMarginPreset({
      ...options,
      marginTop: p.marginTop, marginRight: p.marginRight,
      marginBottom: p.marginBottom, marginLeft: p.marginLeft,
    }));
  }, [set, options]);

  // When any individual setting changes, re-detect style preset
  const setAndDetect = useCallback(
    <K extends keyof PdfOptions>(key: K, value: PdfOptions[K]) => {
      set(key, value);
      const next = { ...options, [key]: value };
      setStylePreset(detectStylePreset(next));
    },
    [set, options],
  );

  const handleMarginPresetChange = useCallback((preset: string) => {
    setMarginPreset(preset);
    const p = MARGIN_PRESETS[preset];
    if (p) {
      set("marginTop", p.top);
      set("marginRight", p.right);
      set("marginBottom", p.bottom);
      set("marginLeft", p.left);
      const next = { ...options, marginTop: p.top, marginRight: p.right, marginBottom: p.bottom, marginLeft: p.left };
      setStylePreset(detectStylePreset(next));
    }
  }, [set, options]);

  const handleMarginChange = useCallback(
    (side: MarginSide, value: number) => {
      set(side, value);
      const next = { ...options, [side]: value };
      // Re-detect margin preset
      let found = false;
      for (const [name, p] of Object.entries(MARGIN_PRESETS)) {
        if (next.marginTop === p.top && next.marginRight === p.right &&
            next.marginBottom === p.bottom && next.marginLeft === p.left) {
          setMarginPreset(name);
          found = true;
          break;
        }
      }
      if (!found) setMarginPreset("custom");
      setStylePreset(detectStylePreset(next));
    },
    [set, options],
  );

  return (
    <div className="pdf-export-sidebar">
      <div data-tauri-drag-region className="pdf-export-drag-region" />
      <div className="pdf-export-sidebar-content">
        {/* Style preset — top-level, most prominent */}
        <div className="pdf-preset-row">
          <Select
            value={stylePreset}
            options={stylePresetOptions}
            onChange={handleStylePresetChange}
          />
        </div>

        {/* Page Setup — always visible */}
        <PdfSettingsGroup icon={<FileText className="w-3.5 h-3.5" />}>
          <SettingRow label={t("pdf.pageSetup.size")}>
            <Select
              value={options.pageSize}
              options={PAGE_SIZE_OPTIONS}
              onChange={(v) => set("pageSize", v)}
            />
          </SettingRow>
          <SettingRow label={t("pdf.pageSetup.orientation")}>
            <Select
              value={options.orientation}
              options={orientationOptions}
              onChange={(v) => set("orientation", v)}
            />
          </SettingRow>
          <SettingRow label={t("pdf.pageSetup.margins")}>
            <Select
              value={marginPreset}
              options={marginPresetOptions}
              onChange={handleMarginPresetChange}
            />
          </SettingRow>
          <MarginLayoutDiagram
            top={options.marginTop}
            right={options.marginRight}
            bottom={options.marginBottom}
            left={options.marginLeft}
            landscape={options.orientation === "landscape"}
            unitLabel={t("pdf.pageSetup.marginUnit")}
            onChange={handleMarginChange}
          />
        </PdfSettingsGroup>

        {/* Typography — collapsible */}
        <CollapsibleSection title={t("pdf.typography")}>
          <PdfSettingsGroup icon={<Type className="w-3.5 h-3.5" />}>
            <SettingRow label={t("pdf.typography.fontSize")}>
              <Select
                value={String(options.fontSize)}
                options={FONT_SIZE_OPTIONS}
                onChange={(v) => setAndDetect("fontSize", Number(v))}
              />
            </SettingRow>
            <SettingRow label={t("pdf.typography.lineHeight")}>
              <Select
                value={String(options.lineHeight)}
                options={LINE_HEIGHT_OPTIONS}
                onChange={(v) => setAndDetect("lineHeight", Number(v))}
              />
            </SettingRow>
            <SettingRow label={t("pdf.typography.cjkSpacing")}>
              <Select
                value={options.cjkLetterSpacing.replace("em", "")}
                options={cjkSpacingOptions}
                onChange={(v) =>
                  set("cjkLetterSpacing", v === "0" ? "0" : `${v}em`)
                }
              />
            </SettingRow>
            <SettingRow label={t("pdf.typography.latinFont")}>
              <Select
                value={options.latinFont}
                options={latinFontOptions}
                onChange={(v) => setAndDetect("latinFont", v)}
              />
            </SettingRow>
            <SettingRow label={t("pdf.typography.cjkFont")}>
              <Select
                value={options.cjkFont}
                options={cjkFontOptions}
                onChange={(v) => setAndDetect("cjkFont", v)}
              />
            </SettingRow>
          </PdfSettingsGroup>
        </CollapsibleSection>

        {/* Appearance — collapsible */}
        <CollapsibleSection title={t("pdf.appearance")}>
          <PdfSettingsGroup icon={<Palette className="w-3.5 h-3.5" />}>
            <SettingRow label={t("pdf.appearance.useEditorTheme")}>
              <Toggle
                checked={options.useEditorTheme}
                onChange={(v) => set("useEditorTheme", v)}
              />
            </SettingRow>
          </PdfSettingsGroup>
        </CollapsibleSection>

        {/* Page numbers — collapsible */}
        <CollapsibleSection title={t("pdf.pageNumbers")}>
          <PdfSettingsGroup icon={<Hash className="w-3.5 h-3.5" />}>
            <SettingRow label={t("pdf.pageNumbers.position")}>
              <Select
                value={options.pageNumberPosition}
                options={PAGE_NUMBER_POSITION_OPTIONS.map((o) => ({
                  value: o.value,
                  label: t(o.labelKey),
                }))}
                onChange={(v) => set("pageNumberPosition", v)}
              />
            </SettingRow>
            {/* The format and skip controls do nothing while position is
                "none", so they are hidden rather than shown disabled. */}
            {options.pageNumberPosition !== "none" && (
              <>
                <SettingRow label={t("pdf.pageNumbers.format")}>
                  <Select
                    value={options.pageNumberFormat}
                    options={PAGE_NUMBER_FORMAT_OPTIONS.map((o) => ({
                      value: o.value,
                      label: t(o.labelKey),
                    }))}
                    onChange={(v) => set("pageNumberFormat", v)}
                  />
                </SettingRow>
                <SettingRow label={t("pdf.pageNumbers.skipFirst")}>
                  <Toggle
                    checked={options.pageNumberSkipFirst}
                    onChange={(v) => set("pageNumberSkipFirst", v)}
                  />
                </SettingRow>
              </>
            )}
          </PdfSettingsGroup>
        </CollapsibleSection>
      </div>
      <div className="pdf-export-action-bar">
        <Button
          variant="primary"
          size="sm"
          onClick={onExport}
          disabled={exporting}
        >
          {exporting ? exportStage || t("pdf.exporting") : t("pdf.exportButton")}
        </Button>
      </div>
    </div>
  );
}
