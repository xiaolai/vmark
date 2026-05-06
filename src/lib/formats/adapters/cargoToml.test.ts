// WI-2.5 — Cargo.toml schema detector + dependency-tree renderer.
//
// The "differentiator validation" — VMark's claim that being a
// plain-text workspace means rendering the right view per artifact,
// not just opening any file. Cargo.toml is the second schema POC
// (after WI-2.4 GHA workflows).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetRegistry } from "../registry";
import {
  cargoTomlSchemaDetector,
  collectCargoDependencies,
} from "./cargoToml";

describe("cargoToml schema detector", () => {
  beforeEach(() => __resetRegistry());
  afterEach(() => __resetRegistry());

  it("returns 'cargo-toml' for files named Cargo.toml at any path", () => {
    expect(
      cargoTomlSchemaDetector("/repo/Cargo.toml", '[package]\nname="x"'),
    ).toBe("cargo-toml");
    expect(
      cargoTomlSchemaDetector("/x/y/z/Cargo.toml", '[package]\nname="y"'),
    ).toBe("cargo-toml");
  });

  it("returns 'cargo-toml' for content with [package] header (filename fallback)", () => {
    expect(
      cargoTomlSchemaDetector(
        "/repo/some-other-name.toml",
        '[package]\nname = "still-a-cargo-manifest"',
      ),
    ).toBe("cargo-toml");
  });

  it("returns null for unrelated TOML", () => {
    expect(
      cargoTomlSchemaDetector(
        "/repo/config.toml",
        "[server]\nhost = \"localhost\"",
      ),
    ).toBeNull();
  });

  it("returns null for empty content + unrelated path", () => {
    expect(cargoTomlSchemaDetector("/x/foo.toml", "")).toBeNull();
  });

  it("is case-insensitive on the Cargo.toml filename", () => {
    expect(
      cargoTomlSchemaDetector("/repo/CARGO.TOML", "[package]"),
    ).toBe("cargo-toml");
  });

  it("matches Windows-style paths with backslash separator", () => {
    expect(
      cargoTomlSchemaDetector("C:\\code\\repo\\Cargo.toml", ""),
    ).toBe("cargo-toml");
  });

  it("strips query string before path match", () => {
    expect(
      cargoTomlSchemaDetector("/repo/Cargo.toml?reload=1", ""),
    ).toBe("cargo-toml");
  });

  it("returns 'cargo-toml' for [workspace]-only virtual manifests", () => {
    const yaml = `
[workspace]
members = ["crate-a", "crate-b"]
    `.trim();
    expect(cargoTomlSchemaDetector("/repo/Cargo.toml", yaml)).toBe(
      "cargo-toml",
    );
    // Even with an unrelated filename, the [workspace] header wins.
    expect(cargoTomlSchemaDetector("/x/odd-name.toml", yaml)).toBe(
      "cargo-toml",
    );
  });
});

describe("collectCargoDependencies", () => {
  it("returns empty arrays for a manifest with no dep tables", () => {
    const result = collectCargoDependencies(`
[package]
name = "vmark"
version = "0.7.0"
    `.trim());
    expect(result.runtime).toEqual([]);
    expect(result.dev).toEqual([]);
    expect(result.build).toEqual([]);
  });

  it("collects [dependencies] entries", () => {
    const result = collectCargoDependencies(`
[package]
name = "x"

[dependencies]
serde = "1.0"
tokio = { version = "1", features = ["rt"] }
    `.trim());
    expect(result.runtime).toEqual([
      { name: "serde", version: "1.0", features: [] },
      { name: "tokio", version: "1", features: ["rt"] },
    ]);
  });

  it("collects [dev-dependencies]", () => {
    const result = collectCargoDependencies(`
[dev-dependencies]
tempfile = "3.0"
    `.trim());
    expect(result.dev).toEqual([
      { name: "tempfile", version: "3.0", features: [] },
    ]);
  });

  it("collects [build-dependencies]", () => {
    const result = collectCargoDependencies(`
[build-dependencies]
cc = "1.0"
    `.trim());
    expect(result.build).toEqual([
      { name: "cc", version: "1.0", features: [] },
    ]);
  });

  it("handles git + path deps without throwing", () => {
    const result = collectCargoDependencies(`
[dependencies]
local = { path = "../sibling" }
upstream = { git = "https://example.com/repo" }
    `.trim());
    // Path / git deps have no version; surfaced as empty string.
    expect(result.runtime.map((d) => d.name).sort()).toEqual([
      "local",
      "upstream",
    ]);
  });

  it("returns empty result on syntax error rather than throwing", () => {
    const result = collectCargoDependencies("[unclosed");
    expect(result.runtime).toEqual([]);
    expect(result.dev).toEqual([]);
    expect(result.build).toEqual([]);
    expect(result.parseError).toBeDefined();
  });

  it("returns features for inline-table deps", () => {
    const result = collectCargoDependencies(`
[dependencies]
serde = { version = "1", features = ["derive", "rc"] }
    `.trim());
    expect(result.runtime[0].features).toEqual(["derive", "rc"]);
  });
});
