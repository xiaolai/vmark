// WI-2.3 — YAML adapter.
//
// Real CodeMirror language (@codemirror/lang-yaml — installed since
// Phase 1A) + `yaml`-library validator. Tree preview shares the
// react-json-view-lite component used by the JSON/TOML adapters.
//
// WI-2.4 wires GHA-workflow schemaDetector into this adapter.
//
// WI-13 — yaml is in the ALWAYS-ON trio, so every static import here is cold
// start for every window, including the ones with no editor. The workbench +
// workflow IR parser moved behind `React.lazy` (./yamlWorkflowRenderer), the
// CodeMirror pack behind the `language`/`loadLanguage` thunks, and the GHA
// source extensions behind dynamic imports inside `loadExtraExtensions` —
// which was already async, so nothing but the import site changed.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Extension } from "@codemirror/state";
import { parse as parseYaml } from "yaml";
import { JsonView } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { RetryableLazy } from "@/components/RetryableLazy";
import { loadWorkflowSourceExtensions } from "./yamlWorkflowExtensions";
import { jsonViewStyles } from "./jsonViewStyles";
import "./json-tree.css";
import {
  isWorkflowYaml,
  looksLikeWorkflowPath,
} from "@/lib/ghaWorkflow/detection";
import { lintYaml } from "@/lib/lintEngine/yaml";
import { registerFormat } from "../registry";
import type {
  FormatConfig,
  PreviewRendererProps,
  SchemaDetector,
  ValidationDiagnostic,
  Validator,
} from "../types";
import { errorMessage } from "@/utils/errorMessage";

interface YamlException extends Error {
  /** `yaml` library reports positions as 1-based { line, col } in `linePos`. */
  linePos?: Array<{ line: number; col: number }>;
}

/** The CodeMirror YAML pack, loaded on demand (WI-13). */
const loadYamlLanguage = async (): Promise<Extension> => {
  const { yaml } = await import("@codemirror/lang-yaml");
  return yaml();
};

export const yamlValidator: Validator = (content) => {
  if (content.length === 0) return [];
  try {
    parseYaml(content);
    return [];
  } catch (error) {
    const err = error as YamlException;
    // `yaml` positions are already 1-based — use directly for the gutter.
    const pos = err.linePos?.[0];
    const line = pos?.line ?? 1;
    const column = pos?.col ?? 1;
    const message = errorMessage(err);
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
  // match, we can return null without paying for the YAML parse.
  if (!isWorkflowYaml(content)) return null;
  // Per ADR-5: content detection on syntactically invalid content
  // returns null. Run the parser; on failure, decline.
  try {
    parseYaml(content);
  } catch {
    return null;
  }
  return "gha-workflow";
};

/**
 * WI-2.4 — GitHub Actions workflow schemaRenderer.
 *
 * The renderer itself (workflow IR parse + the workbench + its xyflow canvas)
 * lives in ./yamlWorkflowRenderer and is loaded on demand: WI-13 moved it out
 * because this adapter is always registered, so a static reference put the
 * whole workbench on every window's cold start.
 *
 * The boundary is HERE rather than at the host: `schemaRenderers` is a plain
 * `ComponentType` map and SplitPaneEditor mounts whatever it finds, so a bare
 * lazy component would suspend — and REJECT — into whichever boundary happened
 * to be above it.
 *
 * Audit 20260804-F3: it used to be a bare `Suspense` over a module-level
 * `React.lazy`, so a rejected import escaped to the editor-wide boundary,
 * whose "try again" remounted the SAME lazy object and replayed its cached
 * rejection forever. `RetryableLazy` gives it the FormatSurface discipline
 * instead: a fresh lazy per attempt behind a local, retryable boundary, so the
 * failure stays inside the preview pane and the retry can actually succeed.
 */
const loadGhaWorkflowRenderer = () =>
  import("./yamlWorkflowRenderer").then((m) => ({
    default: m.GhaWorkflowSchemaRenderer,
  }));

function GhaWorkflowRendererError({ retry }: { retry: () => void }) {
  const { t } = useTranslation("editor");
  return (
    <div className="json-tree-preview json-tree-preview--invalid" role="alert">
      <span>{t("preview.failedToLoad")}</span>{" "}
      <button type="button" className="vm-btn" onClick={retry}>
        {t("dialog:errorBoundary.tryAgain")}
      </button>
    </div>
  );
}

function GhaWorkflowSchemaRenderer(props: PreviewRendererProps) {
  return (
    <RetryableLazy
      feature="GitHub Actions workflow"
      load={loadGhaWorkflowRenderer}
      componentProps={props}
      // Fallback is null — the split pane already shows the source side.
      pending={null}
      renderError={(retry) => <GhaWorkflowRendererError retry={retry} />}
    />
  );
}

function YamlTreePreview({ content, diagnostics }: PreviewRendererProps) {
  const { t } = useTranslation("editor");
  const isDark = useIsDarkTheme();
  const parsed = useMemo(() => {
    try {
      return parseYaml(content);
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
      <JsonView data={parsed as any} style={jsonViewStyles(isDark)} />
    </div>
  );
}

export const yamlFormat: FormatConfig = {
  id: "yaml",
  nameI18nKey: "format.yaml",
  extensions: ["yaml", "yml"],
  kind: "split-pane",
  // One loader, two fields: `language` is what a WYSIWYG-kind host reads and
  // `loadLanguage` what the split pane reads. Both are thunks since WI-13, so
  // there is nothing left to duplicate — a second copy would just be a second
  // place to forget.
  language: loadYamlLanguage,
  loadLanguage: loadYamlLanguage,
  lint: (source: string) => lintYaml(source),
  // GHA workflow editor behavior for the source pane. Dynamic imports
  // (WI-13): these four CodeMirror extensions are a megabyte of
  // source-editor machinery that only a mounted YAML source pane can use.
  // They load INDIVIDUALLY and degrade individually (audit 20260804-F8) —
  // see ./yamlWorkflowExtensions, which also owns the store binding the
  // plugins must not carry themselves (lint:store-coupling).
  loadExtraExtensions: loadWorkflowSourceExtensions,
  validator: yamlValidator,
  genericPreview: YamlTreePreview,
  schemaDetector: yamlSchemaDetector,
  schemaRenderers: {
    "gha-workflow": GhaWorkflowSchemaRenderer,
  },
  adapters: {
    saveDialogFilters: [{ nameI18nKey: "format.yaml", extensions: ["yaml", "yml"] }],
    untitledExtension: "yaml",
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

export function registerYamlFormat(): void {
  registerFormat(yamlFormat);
}
