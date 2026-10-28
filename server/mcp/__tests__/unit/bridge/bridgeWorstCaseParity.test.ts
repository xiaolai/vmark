/**
 * The sidecar's `BRIDGE_WORST_CASE_MS` restates the Rust bridge's
 * `WRITE_LOCK_WAIT` + `REQUEST_TIMEOUT_TOTAL` (src-tauri/src/mcp_bridge/state.rs) across a language
 * boundary. This reads the Rust constants and fails when the two drift: a
 * Rust total longer than the sidecar believes would let a client timeout
 * report a write the bridge later recovered as failed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRIDGE_WORST_CASE_MS } from '../../../src/bridge/websocketConfig.js';

const STATE_RS = resolve(import.meta.dirname, '../../../../../src-tauri/src/mcp_bridge/state.rs');

describe("the sidecar's view of the Rust bridge's worst case", () => {
  const source = readFileSync(STATE_RS, 'utf8');

  it('equals the Rust total: the write-lock wait, the first wait and the wake-and-retry', () => {
    const wait = /pub\(super\) const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs\((\d+)\);/.exec(source);
    expect(wait, 'REQUEST_TIMEOUT declaration not found in state.rs').not.toBeNull();
    expect(source).toMatch(
      /pub\(super\) const REQUEST_TIMEOUT_TOTAL: std::time::Duration =\s+REQUEST_TIMEOUT\.saturating_add\(REQUEST_TIMEOUT\);/,
    );
    const lock = /pub\(crate\) const WRITE_LOCK_WAIT: std::time::Duration = std::time::Duration::from_secs\((\d+)\);/.exec(source);
    expect(lock, 'WRITE_LOCK_WAIT declaration not found in state.rs').not.toBeNull();
    expect(BRIDGE_WORST_CASE_MS).toBe((Number(lock?.[1]) + 2 * Number(wait?.[1])) * 1000);
  });
});
