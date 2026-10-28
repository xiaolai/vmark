// WI-AL2.0j — the journaled mutation's worst case (pre-apply budget + effects deadline + one commit call + a 3 000 ms margin) fits the MCP bridge's total wait, read from both sources so neither side can change alone
/**
 * The time budget of one journaled mutation against the MCP bridge.
 *
 * The bridge (`src-tauri/src/mcp_bridge/state.rs`) waits `REQUEST_TIMEOUT`
 * after the emit, wakes the webview and waits once more:
 * `REQUEST_TIMEOUT_TOTAL` is twice `REQUEST_TIMEOUT`. A mutation that
 * answers after that reaches the AI client as a timeout while its edit can
 * still land, and a client that retries makes a duplicate edit.
 *
 * The webview's worst case with an apply is the pre-apply budget, then the
 * effects deadline, then one bounded commit call
 * (`src/services/agentJournal/journalDeadline.ts`, `journaledMutation.ts`).
 * It must leave 3 000 ms for the apply itself, timer delay and the response
 * path. Every constant is parsed from its source, and a source that no longer
 * parses fails the gate rather than skipping it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

const BRIDGE_STATE = "src-tauri/src/mcp_bridge/state.rs";
const DEADLINE_TS = "src/services/agentJournal/journalDeadline.ts";
const MUTATION_TS = "src/services/agentJournal/journaledMutation.ts";
/** For the apply, timer delay and the response path. */
const MARGIN_MS = 3000;

/** `export const NAME = <integer>;` in a TypeScript source, in milliseconds. */
export function tsConstant(source, name) {
  const m = source.match(new RegExp(`^export const ${name} = (\\d[\\d_]*);$`, "m"));
  if (!m) throw new Error(`${name}: no \`export const ${name} = <integer>;\``);
  return Number(m[1].replaceAll("_", ""));
}

/** A Rust `Duration` constant built with `from_secs` or `from_millis`, in milliseconds. */
export function rustDurationMs(source, name) {
  const m = source.match(
    new RegExp(`const ${name}: std::time::Duration =\\s*std::time::Duration::from_(secs|millis)\\((\\d[\\d_]*)\\);`),
  );
  if (!m) throw new Error(`${name}: no \`const ${name}: std::time::Duration = Duration::from_secs|from_millis(<integer>);\``);
  const n = Number(m[2].replaceAll("_", ""));
  return m[1] === "secs" ? n * 1000 : n;
}

/** The bridge's total wait: `REQUEST_TIMEOUT_TOTAL`, which must still be twice `REQUEST_TIMEOUT`. */
export function bridgeTotalMs(source) {
  const total = source.match(/const REQUEST_TIMEOUT_TOTAL: std::time::Duration =\s*([^;]+);/);
  if (!total) throw new Error("REQUEST_TIMEOUT_TOTAL: not found");
  const expr = total[1].replace(/\s+/g, "");
  if (expr !== "REQUEST_TIMEOUT.saturating_add(REQUEST_TIMEOUT)") {
    throw new Error(`REQUEST_TIMEOUT_TOTAL is \`${expr}\`, no longer twice REQUEST_TIMEOUT: update this gate`);
  }
  return 2 * rustDurationMs(source, "REQUEST_TIMEOUT");
}

describe("the parsers fail closed", () => {
  it("reads integer constants, with digit separators", () => {
    expect(tsConstant("export const A_MS = 7_000;\n", "A_MS")).toBe(7000);
    expect(rustDurationMs("const T: std::time::Duration = std::time::Duration::from_secs(10);", "T")).toBe(10_000);
    expect(rustDurationMs("const T: std::time::Duration =\n    std::time::Duration::from_millis(2_500);", "T")).toBe(2500);
  });

  it("throws on a constant it cannot read, never defaulting", () => {
    expect(() => tsConstant("export const A_MS = 5 * 1000;\n", "A_MS")).toThrow(/A_MS/);
    expect(() => tsConstant("", "A_MS")).toThrow(/A_MS/);
    expect(() => rustDurationMs("const T: Duration = Duration::from_secs(10);", "T")).toThrow(/T/);
  });

  it("throws when the bridge total is no longer twice the per-wait timeout", () => {
    const base = "const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);\n";
    expect(bridgeTotalMs(`${base}const REQUEST_TIMEOUT_TOTAL: std::time::Duration =\n    REQUEST_TIMEOUT.saturating_add(REQUEST_TIMEOUT);`)).toBe(20_000);
    expect(() =>
      bridgeTotalMs(`${base}const REQUEST_TIMEOUT_TOTAL: std::time::Duration = std::time::Duration::from_secs(30);`),
    ).toThrow(/no longer twice/);
  });
});

describe("the journaled mutation's worst case fits the bridge", () => {
  it("pre-apply budget + effects deadline + one commit call + margin <= the bridge's total", () => {
    const deadline = read(DEADLINE_TS);
    const preapply = tsConstant(deadline, "JOURNAL_PREAPPLY_BUDGET_MS");
    const perCall = tsConstant(deadline, "JOURNAL_DEADLINE_MS");
    const effects = tsConstant(read(MUTATION_TS), "EFFECTS_DEADLINE_MS");
    const total = bridgeTotalMs(read(BRIDGE_STATE));
    expect(preapply + effects + perCall + MARGIN_MS).toBeLessThanOrEqual(total);
  });

  it("each prepare attempt fits inside the pre-apply budget's per-call bound", () => {
    const deadline = read(DEADLINE_TS);
    expect(tsConstant(deadline, "JOURNAL_DEADLINE_MS")).toBeGreaterThan(0);
    expect(tsConstant(deadline, "JOURNAL_PREAPPLY_BUDGET_MS")).toBeGreaterThanOrEqual(tsConstant(deadline, "JOURNAL_DEADLINE_MS"));
  });
});
