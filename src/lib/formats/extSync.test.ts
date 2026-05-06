// ADR-12 / WI-1B.4 — Rust ↔ TS extension-list sync test.
//
// Asserts that the Rust SUPPORTED_EXTENSIONS const and the TypeScript
// format-registry's getSupportedExtensions() output are identical sets.
// scripts/check-ext-sync.sh runs this test as the CI guard.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetRegistry, getSupportedExtensions } from "./registry";
import { bootstrapFormats, __resetBootstrap } from "./index";

function readRustSupportedExtensions(): string[] {
  const path = resolve(__dirname, "..", "..", "..", "src-tauri", "src", "lib.rs");
  const src = readFileSync(path, "utf8");
  // Match the const declaration's bracketed list (multi-line allowed).
  const match = src.match(
    /pub\(crate\)\s+const\s+SUPPORTED_EXTENSIONS:[^=]*=\s*&\[([\s\S]*?)\];/,
  );
  if (!match) {
    throw new Error("Could not parse SUPPORTED_EXTENSIONS from lib.rs");
  }
  const tokens = match[1].match(/"([a-z0-9]+)"/g) ?? [];
  return tokens.map((t) => t.slice(1, -1));
}

describe("Rust ↔ TS extension parity (ADR-12)", () => {
  beforeEach(() => {
    __resetRegistry();
    __resetBootstrap();
    bootstrapFormats();
  });
  afterEach(() => {
    __resetRegistry();
    __resetBootstrap();
  });

  it("Rust SUPPORTED_EXTENSIONS matches TS getSupportedExtensions()", () => {
    const rust = [...readRustSupportedExtensions()].sort();
    const ts = [...getSupportedExtensions()].sort();
    expect(ts).toEqual(rust);
  });

  it("contains every Phase 1A registered extension on both sides", () => {
    const ts = new Set(getSupportedExtensions());
    const rust = new Set(readRustSupportedExtensions());
    for (const ext of [
      "md",
      "markdown",
      "mdown",
      "mkd",
      "mdx",
      "txt",
      "json",
      "jsonl",
      "yaml",
      "yml",
      "toml",
      "mmd",
      "svg",
      "html",
      "htm",
      "ts",
      "tsx",
      "js",
      "jsx",
      "py",
      "rs",
      "go",
      "css",
      "sh",
      "bash",
      "rb",
      "lua",
    ]) {
      expect(ts.has(ext), `TS missing .${ext}`).toBe(true);
      expect(rust.has(ext), `Rust missing .${ext}`).toBe(true);
    }
  });
});
