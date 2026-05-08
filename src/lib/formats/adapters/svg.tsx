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
import { renderSvgBlock } from "@/plugins/svg/svgRender";
import { sanitizeSvg } from "@/utils/sanitize";
import { registerFormat } from "../registry";
import "./svg-preview.css";
import type {
  FormatConfig,
  PreviewRendererProps,
  ValidationDiagnostic,
  Validator,
} from "../types";

interface XmlParseResult {
  ok: boolean;
  errorMessage: string | null;
  errorLine: number;
  errorColumn: number;
}

function parseXml(content: string): XmlParseResult {
  /* v8 ignore next 4 -- @preserve jsdom DOMParser fallback path */
  if (typeof DOMParser === "undefined") {
    return {
      ok: true,
      errorMessage: null,
      errorLine: 1,
      errorColumn: 1,
    };
  }
  const doc = new DOMParser().parseFromString(content, "image/svg+xml");
  const err = doc.querySelector("parsererror");
  if (err) {
    const text = err.textContent ?? "XML parse error";
    return {
      ok: false,
      errorMessage: text,
      errorLine: 1,
      errorColumn: 1,
    };
  }
  return {
    ok: true,
    errorMessage: null,
    errorLine: 1,
    errorColumn: 1,
  };
}

export const svgValidator: Validator = (content) => {
  if (content.length === 0) return [];
  const trimmed = content.trim();
  if (!/^<svg[\s>/]/.test(trimmed) && !trimmed.startsWith("<?xml")) {
    return [
      {
        severity: "error",
        line: 1,
        column: 1,
        message: "Document must start with <svg> or <?xml ...?>",
        ruleId: "svg/missing-root",
      } satisfies ValidationDiagnostic,
    ];
  }
  const parse = parseXml(trimmed);
  if (!parse.ok) {
    return [
      {
        severity: "error",
        line: parse.errorLine,
        column: parse.errorColumn,
        message: parse.errorMessage ?? "XML parse error",
        ruleId: "svg/xml-parse",
      } satisfies ValidationDiagnostic,
    ];
  }
  // Root-element check (cheap; runs after parse).
  /* v8 ignore next 6 -- @preserve DOMParser fallback path */
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(trimmed, "image/svg+xml");
    if (doc.documentElement && doc.documentElement.tagName !== "svg") {
      return [
        {
          severity: "error",
          line: 1,
          column: 1,
          message: `Root element is <${doc.documentElement.tagName}>, expected <svg>`,
          ruleId: "svg/wrong-root",
        } satisfies ValidationDiagnostic,
      ];
    }
  }
  return [];
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
    searchAdapter: "codemirror",
    contentSearchIndexed: true,
    readOnlyDefault: false,
    reloadPolicy: "reload",
    menuPolicy: {
      sourceWysiwygToggle: false,
      cjkFormatActions: false,
      insertBlockActions: false,
      paragraphFormatting: false,
    },
    closeSavePolicy: "markdown-default",
  },
};

export function registerSvgFormat(): void {
  registerFormat(svgFormat);
}
