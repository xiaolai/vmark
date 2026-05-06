// WI-3.1 — Standalone Mermaid (.mmd) adapter.
//
// CodeMirror language pack: codemirror-lang-mermaid 0.5.0 (Phase 0
// WI-0.6 picked exact-pin; SUFFICIENT-FALLBACK verdict — stale upstream
// but no CVEs, no functional risk for stable mermaid grammars).
//
// Validator: lightweight diagram-type pre-flight. Mermaid's own
// parser (Langium) is heavyweight and async-only via the renderer.
// We surface obvious "missing diagram type" failures synchronously
// so the gutter is responsive on every keystroke; the renderer
// supplies the deeper parse errors at render time.
//
// Preview: re-uses the existing renderMermaid() helper. The plan
// (Background table) flagged renderMermaid as environment-coupled
// (depends on document.documentElement.classList for theme +
// getComputedStyle for fonts + transient DOM). The wrapper here
// owns theme + font-size synchronization explicitly so the registry
// dispatch can mount it for any tab without those couplings biting.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Extension } from "@codemirror/state";
import { renderMermaid } from "@/plugins/mermaid";
import { registerFormat } from "../registry";
import type {
  FormatConfig,
  PreviewRendererProps,
  ValidationDiagnostic,
  Validator,
} from "../types";

// Common Mermaid diagram-type keywords (v11). The list is stable per
// https://mermaid.js.org/intro/syntax-reference.html.
const DIAGRAM_HEADERS = [
  "flowchart",
  "graph",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "journey",
  "gantt",
  "pie",
  "quadrantChart",
  "requirementDiagram",
  "gitGraph",
  "mindmap",
  "timeline",
  "zenuml",
  "sankey-beta",
  "xychart-beta",
  "block-beta",
  "C4Context",
  "C4Container",
  "C4Component",
  "C4Dynamic",
  "C4Deployment",
] as const;

export const mermaidValidator: Validator = (content) => {
  if (content.length === 0) return [];
  // Find the first non-empty, non-comment line.
  const firstLine = content
    .split(/\r?\n/)
    .find((line) => line.trim() && !line.trim().startsWith("%%"));
  if (!firstLine) return [];
  const head = firstLine.trim().split(/\s+/)[0];
  const matched = DIAGRAM_HEADERS.some((h) => head === h || head.startsWith(h));
  if (!matched) {
    return [
      {
        severity: "error",
        line: 1,
        column: 1,
        message: `Unknown Mermaid diagram type: "${head}"`,
        ruleId: "mermaid/missing-diagram-type",
      } satisfies ValidationDiagnostic,
    ];
  }
  return [];
};

function MermaidPreview({ content, diagnostics }: PreviewRendererProps) {
  const { t } = useTranslation("editor");
  const [svg, setSvg] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderToken = useRef(0);

  useEffect(() => {
    if (!content.trim()) {
      setSvg(null);
      setRenderError(null);
      return;
    }
    const myToken = ++renderToken.current;
    let cancelled = false;
    void renderMermaid(content)
      .then((result) => {
        /* v8 ignore next 2 -- @preserve race against rapid edits */
        if (cancelled || myToken !== renderToken.current) return;
        if (result === null) {
          setRenderError("render-failed");
          setSvg(null);
        } else {
          setRenderError(null);
          setSvg(result);
        }
      })
      .catch(() => {
        /* v8 ignore next 3 -- @preserve renderMermaid catches its own errors */
        if (cancelled) return;
        setRenderError("render-failed");
        setSvg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [content]);

  const showInvalid = useMemo(
    () => renderError !== null || svg === null,
    [renderError, svg],
  );

  if (!content.trim()) {
    return <div className="mermaid-preview mermaid-preview--empty" />;
  }

  if (showInvalid) {
    return (
      <div className="mermaid-preview mermaid-preview--invalid">
        <span>{t("preview.cannotRender")}</span>
        {diagnostics[0] && (
          <span className="mermaid-preview__hint">
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
      ref={containerRef}
      className="mermaid-preview"
      // SVG comes from Mermaid (trusted source library); no user
      // strings injected. Same pattern the existing markdown
      // mermaid plugin already uses.
      dangerouslySetInnerHTML={{ __html: svg ?? "" }}
    />
  );
}

export const mermaidFormat: FormatConfig = {
  id: "mermaid",
  nameI18nKey: "format.mermaid",
  extensions: ["mmd"],
  kind: "split-pane",
  loadLanguage: async (): Promise<Extension> => {
    const { mermaid } = await import("codemirror-lang-mermaid");
    return mermaid();
  },
  validator: mermaidValidator,
  genericPreview: MermaidPreview,
  adapters: {
    saveDialogFilters: [{ name: "Mermaid", extensions: ["mmd"] }],
    untitledExtension: "mmd",
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

export function registerMermaidFormat(): void {
  registerFormat(mermaidFormat);
}
