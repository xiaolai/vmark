// WI-2.3 — YAML adapter.
//
// Real CodeMirror language (@codemirror/lang-yaml — installed since
// Phase 1A) + js-yaml validator. Tree preview shares the
// react-json-view-lite component used by the JSON/TOML adapters.
//
// WI-2.4 wires GHA-workflow schemaDetector into this adapter.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Extension } from "@codemirror/state";
import jsYaml from "js-yaml";
import { JsonView, defaultStyles, darkStyles } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import "./json-tree.css";
import {
  isWorkflowYaml,
  looksLikeWorkflowPath,
} from "@/lib/ghaWorkflow/detection";
import { parse as parseWorkflow } from "@/lib/ghaWorkflow/parser";
import { WorkflowCanvas } from "@/components/Editor/WorkflowPanel/WorkflowCanvas";
import { getFileName } from "@/utils/pathUtils";
import { registerFormat } from "../registry";
import type {
  FormatConfig,
  PreviewRendererProps,
  SchemaDetector,
  ValidationDiagnostic,
  Validator,
} from "../types";

interface YamlException extends Error {
  mark?: { line: number; column: number };
  reason?: string;
}

export const yamlValidator: Validator = (content) => {
  if (content.length === 0) return [];
  try {
    jsYaml.load(content);
    return [];
  } catch (error) {
    const err = error as YamlException;
    // js-yaml marks are zero-based; convert to 1-based for the gutter.
    const line = err.mark ? err.mark.line + 1 : 1;
    const column = err.mark ? err.mark.column + 1 : 1;
    const message = err.reason
      ? err.reason
      : err instanceof Error
        ? err.message
        : String(err);
    return [
      {
        severity: "error",
        line,
        column,
        message,
        ruleId: "yaml/syntax",
      } satisfies ValidationDiagnostic,
    ];
  }
};

/**
 * WI-2.4 — GitHub Actions workflow schema detector.
 *
 * ADR-5 precedence:
 *   1. Path detection wins. A file under `.github/workflows/` routes
 *      to the workflow renderer even with malformed YAML so the user
 *      sees a degraded view with diagnostics.
 *   2. Content detection on syntactically invalid content returns null
 *      — the regex-based shape check is gated on a successful YAML
 *      parse so a regex hit on broken YAML doesn't false-positive.
 */
export const yamlSchemaDetector: SchemaDetector = (path, content) => {
  if (looksLikeWorkflowPath(path)) return "gha-workflow";
  // Cheap shape pre-filter before the parse — if the regex doesn't
  // match, we can return null without paying for jsYaml.load.
  if (!isWorkflowYaml(content)) return null;
  // Per ADR-5: content detection on syntactically invalid content
  // returns null. Run the parser; on failure, decline.
  try {
    jsYaml.load(content);
  } catch {
    return null;
  }
  return "gha-workflow";
};

/**
 * WI-2.4 — GitHub Actions workflow schemaRenderer.
 *
 * Parses YAML via the existing @/lib/ghaWorkflow/parser and mounts the
 * @xyflow/react canvas. When parsing fails we fall back to the YAML
 * tree preview so the user still sees something useful.
 */
function GhaWorkflowSchemaRenderer({
  content,
  path,
  diagnostics,
}: PreviewRendererProps) {
  const { t } = useTranslation("editor");
  const parseResult = useMemo(() => {
    try {
      // Use a cross-platform basename helper — `.split("/")` drops the
      // final segment on Windows paths (`C:\…\workflow.yml`).
      const fileName = path ? getFileName(path) || "workflow.yml" : "workflow.yml";
      const ir = parseWorkflow(content, fileName);
      return { ok: true as const, ir };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }, [content, path]);

  if (!parseResult.ok) {
    return (
      <div
        className="json-tree-preview json-tree-preview--invalid"
        data-schema="gha-workflow"
      >
        <span>{t("preview.workflowParseFailed")}</span>
        {diagnostics[0] && (
          <span className="json-tree-preview__hint">
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
      className="yaml-workflow-preview"
      data-schema="gha-workflow"
      style={{ width: "100%", height: "100%" }}
    >
      <WorkflowCanvas workflow={parseResult.ir} />
    </div>
  );
}

function YamlTreePreview({ content, diagnostics }: PreviewRendererProps) {
  const { t } = useTranslation("editor");
  const isDark = useIsDarkTheme();
  const parsed = useMemo(() => {
    try {
      return jsYaml.load(content);
    } catch {
      return null;
    }
  }, [content]);

  if (parsed == null) {
    return (
      <div className="json-tree-preview json-tree-preview--invalid">
        <span>{t("preview.cannotRender")}</span>
        {diagnostics[0] && (
          <span className="json-tree-preview__hint">
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
    <div className="json-tree-preview" data-format="yaml">
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <JsonView data={parsed as any} style={isDark ? darkStyles : defaultStyles} />
    </div>
  );
}

export const yamlFormat: FormatConfig = {
  id: "yaml",
  nameI18nKey: "format.yaml",
  extensions: ["yaml", "yml"],
  kind: "split-pane",
  loadLanguage: async (): Promise<Extension> => {
    const { yaml } = await import("@codemirror/lang-yaml");
    return yaml();
  },
  validator: yamlValidator,
  genericPreview: YamlTreePreview,
  schemaDetector: yamlSchemaDetector,
  schemaRenderers: {
    "gha-workflow": GhaWorkflowSchemaRenderer,
  },
  adapters: {
    saveDialogFilters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
    untitledExtension: "yaml",
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

export function registerYamlFormat(): void {
  registerFormat(yamlFormat);
}
