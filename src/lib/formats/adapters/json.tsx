// WI-2.1 — JSON / JSONL adapter.
//
// Real CodeMirror language (@codemirror/lang-json), JSON.parse-based
// validator that emits ValidationDiagnostic[], and a tree preview via
// react-json-view-lite (Phase 0 WI-0.5 pick — only candidate with
// documented keyboard nav + ARIA labelling).
//
// JSONL handling: when filePath ends in `.jsonl`, the validator parses
// each line independently so a single bad line doesn't poison the whole
// document. Lines that are blank or whitespace-only are skipped.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Extension } from "@codemirror/state";
import { JsonView, defaultStyles, darkStyles } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import {
  PackageJsonSchemaRenderer,
  packageJsonSchemaDetector,
} from "./packageJson";
import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { registerFormat } from "../registry";
import "./json-tree.css";
import type {
  FormatConfig,
  PreviewRendererProps,
  ValidationDiagnostic,
  Validator,
} from "../types";

function isJsonlPath(filePath?: string): boolean {
  return Boolean(filePath?.toLowerCase().endsWith(".jsonl"));
}

interface JsonParseError {
  line: number;
  column: number;
  message: string;
}

/**
 * Best-effort JSON parse-error → line/column extraction. JSON.parse
 * throws SyntaxError with messages that carry position info on V8,
 * Spider­Monkey, JSC. We parse the canonical "at position N" /
 * "(line N column M)" forms; otherwise fall back to line 1 col 1.
 */
function locateParseError(content: string, error: unknown): JsonParseError {
  const message =
    error instanceof Error ? error.message : String(error);
  // V8 form 1 (Node 22+): "... at position 23 (line 2 column 8)"
  const lcMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lcMatch) {
    return {
      line: parseInt(lcMatch[1], 10),
      column: parseInt(lcMatch[2], 10),
      message,
    };
  }
  // V8 form 2 (older Node): "... at position 23"
  const posMatch = message.match(/position\s+(\d+)/i);
  if (posMatch) {
    const pos = parseInt(posMatch[1], 10);
    let line = 1;
    let column = 1;
    for (let i = 0; i < pos && i < content.length; i++) {
      if (content[i] === "\n") {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    return { line, column, message };
  }
  return { line: 1, column: 1, message };
}

/** JSON / JSONL validator. Returns one diagnostic per parse error. */
export const jsonValidator: Validator = (content, path) => {
  if (isJsonlPath(path)) {
    const out: ValidationDiagnostic[] = [];
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw.trim()) continue;
      try {
        JSON.parse(raw);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        out.push({
          severity: "error",
          line: i + 1,
          column: 1,
          message,
          ruleId: "json/syntax",
        });
      }
    }
    return out;
  }
  if (content.length === 0) {
    // Translation key resolved by the gutter UI; the validator emits
    // a stable ruleId so consumers can localize without parsing the
    // English message.
    return [
      {
        severity: "error",
        line: 1,
        column: 1,
        message: "Empty document",
        ruleId: "json/empty",
      },
    ];
  }
  try {
    JSON.parse(content);
    return [];
  } catch (error) {
    const loc = locateParseError(content, error);
    return [
      {
        severity: "error",
        line: loc.line,
        column: loc.column,
        message: loc.message,
        ruleId: "json/syntax",
      },
    ];
  }
};

function JsonTreePreview({ content, path, diagnostics }: PreviewRendererProps) {
  const { t } = useTranslation("editor");
  const isDark = useIsDarkTheme();
  const parsed = useMemo(() => {
    try {
      if (isJsonlPath(path ?? undefined)) {
        const lines = content.split(/\r?\n/).filter((l) => l.trim());
        return lines.map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return { __error: l };
          }
        });
      }
      return JSON.parse(content);
    } catch {
      return null;
    }
  }, [content, path]);

  if (parsed === null) {
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
    <div className="json-tree-preview">
      <JsonView data={parsed} style={isDark ? darkStyles : defaultStyles} />
    </div>
  );
}

export const jsonFormat: FormatConfig = {
  id: "json",
  nameI18nKey: "format.json",
  extensions: ["json", "jsonl"],
  kind: "split-pane",
  loadLanguage: async (): Promise<Extension> => {
    const { json } = await import("@codemirror/lang-json");
    return json();
  },
  validator: jsonValidator,
  genericPreview: JsonTreePreview,
  schemaDetector: packageJsonSchemaDetector,
  schemaRenderers: {
    "package-json": PackageJsonSchemaRenderer,
  },
  adapters: {
    saveDialogFilters: [{ name: "JSON", extensions: ["json", "jsonl"] }],
    untitledExtension: "json",
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

export function registerJsonFormat(): void {
  registerFormat(jsonFormat);
}
