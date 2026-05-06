// WI-2.5 — Cargo.toml schema detector + dependency-tree renderer.
//
// Schema POC #2 (after WI-2.4 GHA workflows). Validates the
// "schema-aware preview" differentiator: rendering the *right* view
// for a known artifact instead of a generic JSON tree.
//
// No network calls in v1. The renderer reads the manifest, displays
// the dep tree (runtime / dev / build), and stops there — no version
// resolution, no crates.io lookup, no transitive resolution.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { parse as parseToml } from "smol-toml";
import type {
  PreviewRendererProps,
  SchemaDetector,
} from "../types";

// Cross-platform separator — Windows uses backslash. Strip query/fragment
// per dispatchEditor parity.
const CARGO_FILENAME_RE = /(^|[/\\])cargo\.toml($|[?#])/i;

/**
 * Detector precedence per ADR-5: filename match wins, content fallback
 * (top-level `[package]` header) catches manifests with non-standard
 * names (rare but valid in Cargo workspaces).
 */
export const cargoTomlSchemaDetector: SchemaDetector = (path, content) => {
  // Append a sentinel so the path-tail regex catches Cargo.toml at the
  // very end of the string too (no trailing slash).
  if (path && CARGO_FILENAME_RE.test(path + "$")) return "cargo-toml";
  // Content fallback — accept manifests with non-standard names
  // (rare but valid in Cargo workspaces).
  if (/^\s*\[package\]/m.test(content)) return "cargo-toml";
  // Workspace + virtual-manifest fallback per Codex audit.
  if (/^\s*\[workspace\]/m.test(content)) return "cargo-toml";
  return null;
};

export interface CargoDependency {
  name: string;
  version: string;
  features: string[];
}

export interface CargoDependencyResult {
  runtime: CargoDependency[];
  dev: CargoDependency[];
  build: CargoDependency[];
  parseError?: string;
}

function parseDepTable(
  table: unknown,
): CargoDependency[] {
  if (!table || typeof table !== "object") return [];
  const out: CargoDependency[] = [];
  for (const [name, raw] of Object.entries(table as Record<string, unknown>)) {
    if (typeof raw === "string") {
      out.push({ name, version: raw, features: [] });
      continue;
    }
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      const version =
        typeof obj.version === "string" ? obj.version : "";
      const features = Array.isArray(obj.features)
        ? obj.features.filter((f): f is string => typeof f === "string")
        : [];
      out.push({ name, version, features });
    }
  }
  return out;
}

export function collectCargoDependencies(
  content: string,
): CargoDependencyResult {
  let parsed: unknown;
  try {
    parsed = parseToml(content);
  } catch (error) {
    return {
      runtime: [],
      dev: [],
      build: [],
      parseError:
        error instanceof Error ? error.message : String(error),
    };
  }
  const root = (parsed ?? {}) as Record<string, unknown>;
  return {
    runtime: parseDepTable(root.dependencies),
    dev: parseDepTable(root["dev-dependencies"]),
    build: parseDepTable(root["build-dependencies"]),
  };
}

function DependencyList({
  title,
  deps,
}: {
  title: string;
  deps: CargoDependency[];
}) {
  if (deps.length === 0) return null;
  return (
    <section className="cargo-deps__section">
      <h3 className="cargo-deps__heading">
        {title} <span className="cargo-deps__count">{deps.length}</span>
      </h3>
      <ul className="cargo-deps__list">
        {deps.map((d) => (
          <li key={d.name} className="cargo-deps__item">
            <span className="cargo-deps__name">{d.name}</span>
            {d.version && (
              <span className="cargo-deps__version">{d.version}</span>
            )}
            {d.features.length > 0 && (
              <span className="cargo-deps__features">
                {d.features.map((f) => (
                  <span key={f} className="cargo-deps__feature">
                    {f}
                  </span>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CargoTomlSchemaRenderer({
  content,
  diagnostics,
}: PreviewRendererProps) {
  const { t } = useTranslation("editor");
  const result = useMemo(() => collectCargoDependencies(content), [content]);
  const totalDeps =
    result.runtime.length + result.dev.length + result.build.length;

  return (
    <div className="cargo-deps" data-schema="cargo-toml">
      {result.parseError && (
        <div className="cargo-deps__parse-error">
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
      {!result.parseError && totalDeps === 0 && (
        <div className="cargo-deps__empty">{t("cargo.empty")}</div>
      )}
      <DependencyList
        title={t("cargo.dependencies")}
        deps={result.runtime}
      />
      <DependencyList
        title={t("cargo.devDependencies")}
        deps={result.dev}
      />
      <DependencyList
        title={t("cargo.buildDependencies")}
        deps={result.build}
      />
    </div>
  );
}
