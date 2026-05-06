// WI-5.2 — pyproject.toml schema detector + dependency-tree renderer.
//
// TOML adapter wires this. Filename match wins (ADR-5 path-first);
// content fallback covers either PEP 621 ([project]) or Poetry
// ([tool.poetry]) shapes.
//
// Two flavors handled:
//   1. PEP 621 — `[project]` table with `dependencies = [ ... ]`
//      array of PEP 508 strings. `[project.optional-dependencies]`
//      sub-table groups extras.
//   2. Poetry — `[tool.poetry.dependencies]` map of name → spec.
//      Dev deps in either `[tool.poetry.dev-dependencies]` (legacy)
//      or `[tool.poetry.group.<name>.dependencies]` (modern).

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { parse as parseToml } from "smol-toml";
import type {
  PreviewRendererProps,
  SchemaDetector,
} from "../types";

const PYPROJECT_FILENAME_RE = /(^|[/\\])pyproject\.toml$/i;

export const pyprojectTomlSchemaDetector: SchemaDetector = (
  path,
  content,
) => {
  if (path) {
    const stripped = path.replace(/[?#].*$/, "");
    if (PYPROJECT_FILENAME_RE.test(stripped)) return "pyproject-toml";
  }
  // Content fallback per ADR-5 rule 3 — must parse cleanly before
  // we trust the regex shape match. Avoids routing broken TOML to
  // a renderer that would crash trying to read it.
  if (
    !/^\s*\[project\]/m.test(content) &&
    !/^\s*\[tool\.poetry\]/m.test(content)
  ) {
    return null;
  }
  try {
    parseToml(content);
  } catch {
    return null;
  }
  return "pyproject-toml";
};

export interface PythonDependency {
  /** PEP 508 / Poetry name. */
  name: string;
  /** Version spec (e.g. ">=2.31.0", "^4.2"). Empty when only a name is given. */
  spec: string;
}

export interface PyprojectResult {
  runtime: PythonDependency[];
  optionalGroups: Record<string, PythonDependency[]>;
  poetryRuntime: PythonDependency[];
  poetryDev: PythonDependency[];
  parseError?: string;
}

const PEP_508_RE = /^([A-Za-z0-9_.-]+)\s*(.*)$/;

function parsePep508Spec(spec: string): PythonDependency {
  const trimmed = spec.trim();
  const match = trimmed.match(PEP_508_RE);
  if (!match) return { name: trimmed, spec: "" };
  return { name: match[1], spec: match[2].trim() };
}

function parsePoetryMap(table: unknown): PythonDependency[] {
  if (!table || typeof table !== "object" || Array.isArray(table)) return [];
  const out: PythonDependency[] = [];
  for (const [name, raw] of Object.entries(
    table as Record<string, unknown>,
  )) {
    if (typeof raw === "string") {
      out.push({ name, spec: raw });
    } else if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      const spec =
        typeof obj.version === "string" ? obj.version : "";
      out.push({ name, spec });
    }
  }
  return out;
}

export function collectPyprojectDependencies(
  content: string,
): PyprojectResult {
  let parsed: unknown;
  try {
    parsed = parseToml(content);
  } catch (error) {
    return {
      runtime: [],
      optionalGroups: {},
      poetryRuntime: [],
      poetryDev: [],
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
  const root = (parsed ?? {}) as Record<string, unknown>;

  // PEP 621 [project] block
  const project = (root.project ?? {}) as Record<string, unknown>;
  const projectDeps = Array.isArray(project.dependencies)
    ? (project.dependencies as unknown[])
        .filter((d): d is string => typeof d === "string")
        .map(parsePep508Spec)
    : [];
  const optTable = project["optional-dependencies"];
  const optionalGroups: Record<string, PythonDependency[]> = {};
  if (optTable && typeof optTable === "object" && !Array.isArray(optTable)) {
    for (const [groupName, groupValue] of Object.entries(
      optTable as Record<string, unknown>,
    )) {
      if (Array.isArray(groupValue)) {
        optionalGroups[groupName] = (groupValue as unknown[])
          .filter((d): d is string => typeof d === "string")
          .map(parsePep508Spec);
      }
    }
  }

  // Poetry [tool.poetry]
  const tool = (root.tool ?? {}) as Record<string, unknown>;
  const poetry = (tool.poetry ?? {}) as Record<string, unknown>;
  const poetryRuntime = parsePoetryMap(poetry.dependencies);
  const poetryDev: PythonDependency[] = [];
  poetryDev.push(...parsePoetryMap(poetry["dev-dependencies"]));
  // Modern Poetry: [tool.poetry.group.<name>.dependencies]
  const groups = (poetry.group ?? {}) as Record<string, unknown>;
  for (const [, groupValue] of Object.entries(groups)) {
    if (groupValue && typeof groupValue === "object") {
      const groupObj = groupValue as Record<string, unknown>;
      poetryDev.push(...parsePoetryMap(groupObj.dependencies));
    }
  }

  return {
    runtime: projectDeps,
    optionalGroups,
    poetryRuntime,
    poetryDev,
  };
}

function DepList({
  title,
  deps,
}: {
  title: string;
  deps: PythonDependency[];
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
            {d.spec && (
              <span className="cargo-deps__version">{d.spec}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PyprojectTomlSchemaRenderer({
  content,
  diagnostics,
}: PreviewRendererProps) {
  const { t } = useTranslation("editor");
  const result = useMemo(
    () => collectPyprojectDependencies(content),
    [content],
  );
  const total =
    result.runtime.length +
    result.poetryRuntime.length +
    result.poetryDev.length +
    Object.values(result.optionalGroups).reduce(
      (sum, group) => sum + group.length,
      0,
    );

  return (
    <div className="cargo-deps" data-schema="pyproject-toml">
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
      {!result.parseError && total === 0 && (
        <div className="cargo-deps__empty">{t("cargo.empty")}</div>
      )}
      <DepList title={t("cargo.dependencies")} deps={result.runtime} />
      {Object.entries(result.optionalGroups).map(([groupName, deps]) => (
        <DepList
          key={`opt-${groupName}`}
          title={t("python.optionalGroup", { group: groupName })}
          deps={deps}
        />
      ))}
      <DepList
        title={t("python.poetryDependencies")}
        deps={result.poetryRuntime}
      />
      <DepList
        title={t("python.poetryDevDependencies")}
        deps={result.poetryDev}
      />
    </div>
  );
}
