// WI-5.2 — pyproject.toml schema detector + dependency-tree renderer tests.
//
// Covers PEP 621 [project] (optional-dependencies → groups) and Poetry
// [tool.poetry] (dependencies + dev-dependencies).

import { describe, expect, it } from "vitest";
import {
  pyprojectTomlSchemaDetector,
  collectPyprojectDependencies,
} from "./pyprojectToml";

describe("pyprojectTomlSchemaDetector", () => {
  it("matches files named pyproject.toml (POSIX path)", () => {
    expect(
      pyprojectTomlSchemaDetector("/repo/pyproject.toml", ""),
    ).toBe("pyproject-toml");
  });

  it("matches files named pyproject.toml (Windows backslash)", () => {
    expect(
      pyprojectTomlSchemaDetector("C:\\code\\repo\\pyproject.toml", ""),
    ).toBe("pyproject-toml");
  });

  it("strips query string before path match", () => {
    expect(
      pyprojectTomlSchemaDetector("/repo/pyproject.toml?reload=1", ""),
    ).toBe("pyproject-toml");
  });

  it("matches PEP 621 content (filename fallback) at unrelated path", () => {
    const content = `
[project]
name = "vmark"
version = "0.7.0"
    `.trim();
    expect(
      pyprojectTomlSchemaDetector("/x/odd-name.toml", content),
    ).toBe("pyproject-toml");
  });

  it("matches Poetry content (filename fallback) at unrelated path", () => {
    const content = `
[tool.poetry]
name = "vmark"
version = "0.7.0"
    `.trim();
    expect(
      pyprojectTomlSchemaDetector("/x/odd-name.toml", content),
    ).toBe("pyproject-toml");
  });

  it("returns null for unrelated TOML at unrelated path", () => {
    expect(
      pyprojectTomlSchemaDetector(
        "/x/config.toml",
        '[server]\nhost = "localhost"',
      ),
    ).toBeNull();
  });

  it("returns null for syntactically invalid TOML even when shape matches (ADR-5)", () => {
    // Regex-only shape match would say yes, but TOML parse fails.
    const broken = `
[project
name = "x"
    `.trim();
    expect(pyprojectTomlSchemaDetector("/x/random.toml", broken)).toBeNull();
  });

  it("path detection still wins on syntactically invalid TOML", () => {
    // Same broken content under pyproject.toml — degraded view per
    // ADR-5 path-first rule.
    const broken = "[project\nname = ::: invalid";
    expect(
      pyprojectTomlSchemaDetector("/repo/pyproject.toml", broken),
    ).toBe("pyproject-toml");
  });
});

describe("collectPyprojectDependencies", () => {
  it("returns empty results for empty document", () => {
    const result = collectPyprojectDependencies("");
    expect(result.runtime).toEqual([]);
    expect(result.optionalGroups).toEqual({});
    expect(result.poetryRuntime).toEqual([]);
    expect(result.poetryDev).toEqual([]);
  });

  it("collects PEP 621 [project] dependencies (array form)", () => {
    const content = `
[project]
name = "x"
version = "1.0.0"
dependencies = [
  "requests>=2.31.0",
  "click>=8.0.0",
]
    `.trim();
    const result = collectPyprojectDependencies(content);
    expect(result.runtime).toEqual([
      { name: "requests", spec: ">=2.31.0" },
      { name: "click", spec: ">=8.0.0" },
    ]);
  });

  it("collects PEP 621 optional-dependencies groups", () => {
    const content = `
[project]
name = "x"
[project.optional-dependencies]
test = ["pytest>=7", "coverage"]
docs = ["sphinx"]
    `.trim();
    const result = collectPyprojectDependencies(content);
    expect(result.optionalGroups.test).toEqual([
      { name: "pytest", spec: ">=7" },
      { name: "coverage", spec: "" },
    ]);
    expect(result.optionalGroups.docs).toEqual([
      { name: "sphinx", spec: "" },
    ]);
  });

  it("collects Poetry [tool.poetry.dependencies]", () => {
    const content = `
[tool.poetry]
name = "x"
[tool.poetry.dependencies]
python = "^3.11"
requests = "^2.31"
    `.trim();
    const result = collectPyprojectDependencies(content);
    expect(result.poetryRuntime).toEqual([
      { name: "python", spec: "^3.11" },
      { name: "requests", spec: "^2.31" },
    ]);
  });

  it("collects Poetry dev dependencies in both legacy + group syntax", () => {
    const content = `
[tool.poetry.dev-dependencies]
black = "^23"

[tool.poetry.group.dev.dependencies]
ruff = "^0.4"
    `.trim();
    const result = collectPyprojectDependencies(content);
    const names = result.poetryDev.map((d) => d.name).sort();
    expect(names).toEqual(["black", "ruff"]);
  });

  it("returns empty result + parseError on syntax error", () => {
    const result = collectPyprojectDependencies("[unclosed");
    expect(result.runtime).toEqual([]);
    expect(result.poetryRuntime).toEqual([]);
    expect(result.parseError).toBeDefined();
  });

  it("handles inline-table dep specs (Poetry caret + extras)", () => {
    const content = `
[tool.poetry.dependencies]
django = { version = "^4.2", extras = ["argon2"] }
    `.trim();
    const result = collectPyprojectDependencies(content);
    expect(result.poetryRuntime).toEqual([
      { name: "django", spec: "^4.2" },
    ]);
  });
});
