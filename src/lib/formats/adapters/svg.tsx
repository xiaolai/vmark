// WI-3.2 — Standalone SVG (.svg) adapter.
//
// CodeMirror language: @codemirror/lang-xml.
// Validator: well-formedness check (must start with <svg or <?xml,
// must parse as XML, root element must be <svg>). Reuses the same
// rules as the existing src/plugins/svg/svgRender.ts so the
// behavior stays consistent.
// Preview: inline SVG render via the existing renderSvgBlock helper.
//
// Per the plan, the SVG renderer is pure (no environment coupling),
// so the wrapper is thin compared to Mermaid's.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Extension } from "@codemirror/state";
import { parseSvg, renderSvgBlock } from "@/plugins/svg/svgRender";
import { sanitizeSvg } from "@/utils/sanitize";
import { registerFormat } from "../registry";
import "./svg-preview.css";
import type {
  FormatConfig,
  PreviewRendererProps,
  ValidationDiagnostic,
  Validator,
} from "../types";

export const svgValidator: Validator = (content) => {
  if (content.length === 0) return [];

  // One parse, one notion of well-formed (WI-4.7). This file used to run its
  // own DOMParser twice — once for the parsererror check and again for the root
  // element — alongside renderSvgBlock's third, with two independently
  // maintained definitions of "valid SVG".
  const { error } = parseSvg(content);
  if (error === null) return [];

  const diagnostic = (message: string, ruleId: string): ValidationDiagnostic => ({
    severity: "error",
    line: 1,
    column: 1,
    message,
    ruleId,
  });

  switch (error.kind) {
    case "empty":
      return [];
    case "not-svg":
      return [
        diagnostic("Document must start with <svg> or <?xml ...?>", "svg/missing-root"),
      ];
    case "malformed":
      return [diagnostic(error.message, "svg/xml-parse")];
    case "wrong-root":
      return [
        diagnostic(
          `Root element is <${error.tagName}>, expected <svg>`,
          "svg/wrong-root",
        ),
      ];
  }
};

function SvgPreview({ content, diagnostics }: PreviewRendererProps) {
  const { t } = useTranslation("editor");
  const rendered = useMemo(() => {
    const raw = renderSvgBlock(content);
    if (raw === null) return null;
    // Sanitize before render — strip scripts, javascript: URLs,
    // event handlers from arbitrary user-supplied SVG. Matches the
    // existing src/plugins/svg path which also sanitizes.
    return sanitizeSvg(raw);
  }, [content]);

  if (!content.trim()) {
    return <div className="svg-preview svg-preview--empty" />;
  }

  if (rendered === null) {
    return (
      <div className="svg-preview svg-preview--invalid">
        <span>{t("preview.cannotRender")}</span>
        {diagnostics[0] && (
          <span className="svg-preview__hint">
            {" "}
            {t("preview.errorAt", {
              line: diagnostics[0].line,
              column: diagnostics[0].column,
            })}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className="svg-preview"
      // The renderer's well-formedness check above is the source of
      // trust: only valid SVG well-formed XML reaches this branch.
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
}

export const svgFormat: FormatConfig = {
  id: "svg",
  nameI18nKey: "format.svg",
  extensions: ["svg"],
  kind: "split-pane",
  loadLanguage: async (): Promise<Extension> => {
    const { xml } = await import("@codemirror/lang-xml");
    return xml();
  },
  validator: svgValidator,
  genericPreview: SvgPreview,
  adapters: {
    saveDialogFilters: [{ name: "SVG", extensions: ["svg"] }],
    untitledExtension: "svg",
    exportEnabled: false,
    findEnabled: true,
    contentSearchIndexed: true,
    readOnlyDefault: false,
    reloadPolicy: "reload",
    menuPolicy: {
      sourceWysiwygToggle: false,
      cjkFormatActions: false,
      insertBlockActions: false,
      paragraphFormatting: false,
    },
    closeSavePolicy: "prompt-on-close",
  },
};

export function registerSvgFormat(): void {
  registerFormat(svgFormat);
}
