// WI-2.3 — YAML adapter.
//
// Real CodeMirror language (@codemirror/lang-yaml — installed since
// Phase 1A) + js-yaml validator. Tree preview shares the
// react-json-view-lite component used by the JSON/TOML adapters.
//
// WI-2.4 wires GHA-workflow schemaDetector into this adapter.

import { useMemo } from "react";
import type { Extension } from "@codemirror/state";
import jsYaml from "js-yaml";
import { JsonView, defaultStyles } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import {
  isWorkflowYaml,
  looksLikeWorkflowPath,
} from "@/lib/ghaWorkflow/detection";
import { parse as parseWorkflow } from "@/lib/ghaWorkflow/parser";
import { WorkflowCanvas } from "@/components/Editor/WorkflowPanel/WorkflowCanvas";
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
 * ADR-5 precedence: path detection wins over content detection. A
 * file under `.github/workflows/` routes to the workflow renderer
 * even with malformed YAML so the user sees a degraded view with
 * diagnostics instead of falling back to a generic tree.
 */
export const yamlSchemaDetector: SchemaDetector = (path, content) => {
  if (looksLikeWorkflowPath(path)) return "gha-workflow";
  if (isWorkflowYaml(content)) return "gha-workflow";
  return null;
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
  const parseResult = useMemo(() => {
    try {
      const fileName = path
        ? path.split("/").pop() ?? "workflow.yml"
        : "workflow.yml";
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
        className="yaml-tree-preview yaml-tree-preview--invalid"
        data-schema="gha-workflow"
      >
        <span>Workflow parse failed — fix syntax errors</span>
        {diagnostics[0] && (
          <span className="yaml-tree-preview__hint">
            {" "}
            ({diagnostics[0].line}:{diagnostics[0].column})
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
  const parsed = useMemo(() => {
    try {
      return jsYaml.load(content);
    } catch {
      return null;
    }
  }, [content]);

  if (parsed == null) {
    return (
      <div className="yaml-tree-preview yaml-tree-preview--invalid">
        <span>Cannot render preview — fix syntax errors</span>
        {diagnostics[0] && (
          <span className="yaml-tree-preview__hint">
            {" "}
            ({diagnostics[0].line}:{diagnostics[0].column})
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="yaml-tree-preview">
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <JsonView data={parsed as any} style={defaultStyles} />
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
