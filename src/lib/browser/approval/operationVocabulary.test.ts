// @vitest-environment node
// Audit 2026-09-03 #13 — the browser-operation vocabulary lives in TWO languages
// (grants.ts here, operation.rs in the driver) and used to live in THREE files;
// the TS copies had drifted (`publish` present in one, `upload` missing from the
// other). This reads the Rust `from_wire` arms off disk and asserts identity with
// `BROWSER_OPERATIONS`, so a token added on one side without the other fails here.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BROWSER_OPERATIONS } from "./grants";

const OPERATION_RS = resolve(process.cwd(), "src-tauri/src/browser/operation.rs");

/** The wire tokens `BrowserOperation::from_wire` accepts, in source order. */
function rustWireOperations(): string[] {
  const source = readFileSync(OPERATION_RS, "utf8");
  const body = source.slice(source.indexOf("fn from_wire"), source.indexOf("impl<'de> serde::Deserialize"));
  return [...body.matchAll(/"([a-z]+)" => Some\(Self::/g)].map((m) => m[1]);
}

describe("browser operation vocabulary parity", () => {
  it("the Rust from_wire arms and BROWSER_OPERATIONS are the same set", () => {
    const rust = rustWireOperations();
    expect(rust.length).toBeGreaterThan(0);
    expect([...rust].sort()).toEqual([...BROWSER_OPERATIONS].sort());
  });

  it("neither side carries publish", () => {
    expect(rustWireOperations()).not.toContain("publish");
    expect(BROWSER_OPERATIONS).not.toContain("publish");
  });
});
