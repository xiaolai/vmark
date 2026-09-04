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

/**
 * The wire tokens `BrowserOperation::from_wire` accepts, in source order.
 *
 * Both anchors are ASSERTED, because a missing one is silent: the end anchor used
 * to be the `Deserialize` impl, which round 3 (#26) deleted as an unused wire
 * type, and `indexOf` then returned -1 — `slice(start, -1)` reads to the end of
 * the file and the test stays green off a slice that no longer means anything.
 */
function rustWireOperations(): string[] {
  const source = readFileSync(OPERATION_RS, "utf8");
  const start = source.indexOf("fn from_wire");
  const end = source.indexOf("pub fn is_known_operation");
  expect(start, "operation.rs no longer declares fn from_wire").toBeGreaterThan(-1);
  expect(end, "operation.rs no longer declares is_known_operation after from_wire").toBeGreaterThan(start);
  return [...source.slice(start, end).matchAll(/"([a-z]+)" => Some\(Self::/g)].map((m) => m[1]);
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
