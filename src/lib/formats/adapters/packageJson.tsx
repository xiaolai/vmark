// WI-5.1 — package.json schema detector + dependency-tree renderer.
//
// JSON adapter wires this detector. Filename match wins (ADR-5
// path-first); content fallback catches manifests with non-standard
// names (a `dependencies` map alongside `name`/`version`).

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type {
  PreviewRendererProps,
  SchemaDetector,
} from "../types";
import { DepList } from "./DepList";
import "./dep-tree.css";

const PACKAGE_FILENAME_RE = /(^|[/\\])package\.json$/i;

export const packageJsonSchemaDetector: SchemaDetector = (path, content) => {
  if (path) {
    const stripped = path.replace(/[?#].*$/, "");
    if (PACKAGE_FILENAME_RE.test(stripped)) return "package-json";
  }
  // Content fallback per ADR-5 — must parse cleanly AND have
  // package-shaped fields.
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const hasName = typeof obj.name === "string";
      const hasDeps =
        (obj.dependencies && typeof obj.dependencies === "object") ||
        (obj.devDependencies && typeof obj.devDependencies === "object") ||
        (obj.peerDependencies && typeof obj.peerDependencies === "object");
      if (hasName && hasDeps) return "package-json";
    }
  } catch {
    /* invalid JSON → null per ADR-5 rule 3 */
  }
  return null;
};

export interface NpmDependency {
  name: string;
  version: string;
}

export interface PackageJsonResult {
  runtime: NpmDependency[];
  dev: NpmDependency[];
  peer: NpmDependency[];
  optional: NpmDependency[];
  parseError?: string;
}

function parseDepMap(table: unknown): NpmDependency[] {
  if (!table || typeof table !== "object" || Array.isArray(table)) return [];
  const out: NpmDependency[] = [];
  for (const [name, raw] of Object.entries(table as Record<string, unknown>)) {
    if (typeof raw === "string") {
      out.push({ name, version: raw });
    }
  }
  return out;
}

export function collectPackageJsonDependencies(
  content: string,
): PackageJsonResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return {
      runtime: [],
      dev: [],
      peer: [],
      optional: [],
      parseError:
        error instanceof Error ? error.message : String(error),
    };
  }
  const root = (parsed ?? {}) as Record<string, unknown>;
  return {
    runtime: parseDepMap(root.dependencies),
    dev: parseDepMap(root.devDependencies),
    peer: parseDepMap(root.peerDependencies),
    optional: parseDepMap(root.optionalDependencies),
  };
}

export function PackageJsonSchemaRenderer({
  content,
  diagnostics,
}: PreviewRendererProps) {
  const { t } = useTranslation("editor");
  const result = useMemo(
    () => collectPackageJsonDependencies(content),
    [content],
  );
  const total =
    result.runtime.length +
    result.dev.length +
    result.peer.length +
    result.optional.length;

  return (
    <div className="dep-tree" data-schema="package-json">
      {result.parseError && (
        <div className="dep-tree__parse-error">
          {t("preview.cannotRender")}
          {diagnostics[0] && (
            <span>
              {" "}
              {t("preview.errorAt", {
                line: diagnostics[0].line,
                column: diagnostics[0].column,
              })}
            </span>
          )}
        </div>
      )}
      {!result.parseError && total === 0 && (
        <div className="dep-tree__empty">{t("cargo.empty")}</div>
      )}
      <DepList title={t("cargo.dependencies")} deps={result.runtime} />
      <DepList title={t("cargo.devDependencies")} deps={result.dev} />
      <DepList title={t("npm.peerDependencies")} deps={result.peer} />
      <DepList title={t("npm.optionalDependencies")} deps={result.optional} />
    </div>
  );
}
