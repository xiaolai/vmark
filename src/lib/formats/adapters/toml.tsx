// WI-2.2 — TOML adapter.
//
// CodeMirror highlighting via @codemirror/legacy-modes/mode/toml (the
// pack the project already pulls in via @codemirror/language-data).
// Validation via smol-toml — Phase 0 WI-0.6 picked it over @iarna/toml
// (actively maintained, prior CVEs all fixed in 1.6.1).
// Tree preview via the same react-json-view-lite component used by
// the JSON adapter — TOML parses to a plain object, so the renderer
// is shared.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Extension } from "@codemirror/state";
import { JsonView, defaultStyles } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import { parse as parseToml } from "smol-toml";
import {
  CargoTomlSchemaRenderer,
  cargoTomlSchemaDetector,
} from "./cargoToml";
import {
  PyprojectTomlSchemaRenderer,
  pyprojectTomlSchemaDetector,
} from "./pyprojectToml";
import { registerFormat } from "../registry";
import type {
  FormatConfig,
  PreviewRendererProps,
  ValidationDiagnostic,
  Validator,
} from "../types";

interface TomlError extends Error {
  line?: number;
  column?: number;
  /** smol-toml uses zero-based offsets in some paths; defensive read. */
  pos?: number;
}

export const tomlValidator: Validator = (content) => {
  if (content.length === 0) return [];
  try {
    parseToml(content);
    return [];
  } catch (error) {
    const err = error as TomlError;
    const line = err.line && err.line > 0 ? err.line : 1;
    const column = err.column && err.column > 0 ? err.column : 1;
    const message =
      error instanceof Error ? error.message : String(error);
    return [
      {
        severity: "error",
        line,
        column,
        message,
        ruleId: "toml/syntax",
      } satisfies ValidationDiagnostic,
    ];
  }
};

function TomlTreePreview({ content, diagnostics }: PreviewRendererProps) {
  const { t } = useTranslation("editor");
  const parsed = useMemo(() => {
    try {
      return parseToml(content);
    } catch {
      return null;
    }
  }, [content]);

  if (parsed === null) {
    return (
      <div className="toml-tree-preview toml-tree-preview--invalid">
        <span>{t("preview.cannotRender")}</span>
        {diagnostics[0] && (
          <span className="toml-tree-preview__hint">
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
    <div className="toml-tree-preview">
      <JsonView data={parsed} style={defaultStyles} />
    </div>
  );
}

export const tomlFormat: FormatConfig = {
  id: "toml",
  nameI18nKey: "format.toml",
  extensions: ["toml"],
  kind: "split-pane",
  loadLanguage: async (): Promise<Extension> => {
    const [{ StreamLanguage }, { toml }] = await Promise.all([
      import("@codemirror/language"),
      import("@codemirror/legacy-modes/mode/toml"),
    ]);
    return StreamLanguage.define(toml);
  },
  validator: tomlValidator,
  genericPreview: TomlTreePreview,
  // Composed detector: try Cargo first (filename match wins), then
  // pyproject. Both detectors are pure and side-effect-free.
  schemaDetector: (path, content) =>
    cargoTomlSchemaDetector(path, content) ??
    pyprojectTomlSchemaDetector(path, content),
  schemaRenderers: {
    "cargo-toml": CargoTomlSchemaRenderer,
    "pyproject-toml": PyprojectTomlSchemaRenderer,
  },
  adapters: {
    saveDialogFilters: [{ name: "TOML", extensions: ["toml"] }],
    untitledExtension: "toml",
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

export function registerTomlFormat(): void {
  registerFormat(tomlFormat);
}
