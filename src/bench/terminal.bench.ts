/**
 * PTY Transport Benchmarks (WI-0.1)
 *
 * Plan: dev-docs/plans/20260531-terminal-industrial-best.md
 * Audit: dev-docs/audit/20260531-terminal-integration.md (finding T1)
 *
 * Run: pnpm bench src/bench/terminal.bench.ts
 *
 * Purpose: quantify the cost of the *current* PTY output transport — Rust
 * `Vec<u8>` emitted as a Tauri event, serialized as a JSON array of numbers,
 * received in JS as `number[]`, then coerced to `Uint8Array` (spawnPty.ts:131)
 * — against the *proposed* binary path (ArrayBuffer → Uint8Array view).
 *
 * This isolates the in-process encode/parse component of T1, which is faithfully
 * measurable WITHOUT a running app. The full end-to-end number (IPC bridge +
 * xterm.write) requires the manual app flow documented in
 * dev-docs/grills/terminal/throughput-baseline.md and the WI-0.2 Channel spike.
 *
 * @module bench/terminal
 */

import { bench, describe } from "vitest";
import { generateTerminalOutput, encodeAsJsonNumberArray } from "./helpers";

// Representative payloads. 4 KB is the current single reader chunk
// (pty.rs:253); the larger sizes represent an aggregated burst (build logs,
// `cat`, AI redraws) before flow-control intervenes.
const out4K = generateTerminalOutput(4 * 1024);
const out256K = generateTerminalOutput(256 * 1024);
const out1M = generateTerminalOutput(1024 * 1024);

// Pre-encode the JSON wire form so decode benches measure parse-only cost.
const json4K = encodeAsJsonNumberArray(out4K);
const json256K = encodeAsJsonNumberArray(out256K);
const json1M = encodeAsJsonNumberArray(out1M);

// ---------------------------------------------------------------------------
// ENCODE — producer side (Rust serde proxy). Current path must build the
// number-array JSON; the binary path sends the bytes as-is (no work here).
// ---------------------------------------------------------------------------
describe("encode (producer side)", () => {
  bench("current: Vec<u8> → JSON number array — 4KB", () => {
    encodeAsJsonNumberArray(out4K);
  });
  bench("current: Vec<u8> → JSON number array — 256KB", () => {
    encodeAsJsonNumberArray(out256K);
  });
  bench("current: Vec<u8> → JSON number array — 1MB", () => {
    encodeAsJsonNumberArray(out1M);
  });
  // Binary path baseline: the producer hands off the existing buffer. The
  // .slice() models one defensive copy so the comparison is fair, not zero.
  bench("proposed: binary passthrough (copy) — 1MB", () => {
    out1M.slice();
  });
});

// ---------------------------------------------------------------------------
// DECODE — consumer side (JS receive path). Current: JSON.parse the wire
// string to number[], then Uint8Array.from. Proposed: wrap the ArrayBuffer.
// ---------------------------------------------------------------------------
describe("decode (consumer side) — 4KB", () => {
  bench("current: JSON.parse → number[] → Uint8Array", () => {
    const arr = JSON.parse(json4K) as number[];
    void new Uint8Array(arr);
  });
  bench("proposed: new Uint8Array(arrayBuffer)", () => {
    void new Uint8Array(out4K.buffer.slice(0));
  });
});

describe("decode (consumer side) — 256KB", () => {
  bench("current: JSON.parse → number[] → Uint8Array", () => {
    const arr = JSON.parse(json256K) as number[];
    void new Uint8Array(arr);
  });
  bench("proposed: new Uint8Array(arrayBuffer)", () => {
    void new Uint8Array(out256K.buffer.slice(0));
  });
});

describe("decode (consumer side) — 1MB", () => {
  bench("current: JSON.parse → number[] → Uint8Array", () => {
    const arr = JSON.parse(json1M) as number[];
    void new Uint8Array(arr);
  });
  bench("proposed: new Uint8Array(arrayBuffer)", () => {
    void new Uint8Array(out1M.buffer.slice(0));
  });
});

// ---------------------------------------------------------------------------
// ROUND-TRIP — encode + decode, the full transformation each PTY chunk pays.
// ---------------------------------------------------------------------------
describe("round-trip (encode + decode) — 256KB", () => {
  bench("current: stringify → parse → Uint8Array", () => {
    const s = encodeAsJsonNumberArray(out256K);
    const arr = JSON.parse(s) as number[];
    void new Uint8Array(arr);
  });
  bench("proposed: copy → Uint8Array view", () => {
    void new Uint8Array(out256K.slice().buffer);
  });
});
