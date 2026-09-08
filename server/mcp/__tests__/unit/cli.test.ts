/**
 * `vmark-mcp-server` CLI argument handling.
 *
 * `--port` is an OVERRIDE: an operator uses it to reach a specific VMark
 * instance. A missing or unparseable value used to be dropped silently, and
 * the bridge then fell back to port-file DISCOVERY — connecting to whichever
 * instance had published the port file, which is the one the override was
 * steering away from (audit R2 #198). Driven as a subprocess because importing
 * `cli.ts` starts the server; every case here exits before that.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOL_REGISTRY, EXPECTED_TOOL_COUNT } from '../../src/index.js';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(PKG, 'src', 'cli.ts');
const HEALTH_CHECK = path.join(PKG, 'src', 'utils', 'healthCheck.ts');
/** The literal `cli.ts` declares — read from source, since importing it starts the server. */
const VERSION = (() => {
  const m = /const VERSION = '([^']+)'/.exec(readFileSync(CLI, 'utf8'));
  if (!m) throw new Error('cli.ts no longer declares a single-quoted VERSION literal');
  return m[1];
})();

function run(...args: string[]) {
  return spawnSync('pnpm', ['exec', 'tsx', CLI, ...args], {
    cwd: PKG,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

describe('cli --port', () => {
  it.each([
    ['no value at all', []],
    ['a following flag instead of a value', ['--verbose']],
    ['a non-numeric value', ['bogus']],
    ['a value with trailing junk', ['4123junk']],
    ['out of range', ['70000']],
    ['zero', ['0']],
  ])('exits 64 on %s rather than falling back to port-file discovery', (_label, rest) => {
    const r = run('--port', ...rest);
    expect(r.status, r.stderr).toBe(64);
    expect(r.stderr).toContain('--port');
  });

  it('exits 64 when --port is given twice with different values', () => {
    const r = run('--port', '4123', '--port', '4124');
    expect(r.status, r.stderr).toBe(64);
    expect(r.stderr).toContain('twice');
  });
});

/**
 * `--version` and `--health-check` write to stdout and then finish. Both used
 * to call `process.exit()` immediately after a `console.log`, and stdout is
 * ASYNCHRONOUS when it is a pipe — which is how every real caller reads them,
 * including the app's `useMcpHealthCheck.ts`, which JSON.parses the result.
 * `spawnSync` uses pipes too, so these cases exercise exactly that path
 * (audit R3 #195).
 */
describe('the one-shot modes finish before they exit', () => {
  it('--version prints the whole version and exits 0', () => {
    const r = run('--version');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe(VERSION);
  });

  it('--health-check prints a COMPLETE JSON report and exits 0', () => {
    const r = run('--health-check');
    expect(r.status, r.stderr).toBe(0);
    // Parsing is the truncation test: a partial write is invalid JSON.
    const report = JSON.parse(r.stdout);
    expect(report.status).toBe('ok');
    expect(report.version).toBe(VERSION);
  });

  it('--health-check does not start the server underneath itself', () => {
    // main() would connect a stdio transport and never return; the run above
    // terminating at all is the assertion, and this pins the guard that makes
    // it so now that neither mode calls process.exit().
    expect(readFileSync(CLI, 'utf8')).toContain('if (!WANTS_VERSION && !WANTS_HEALTH_CHECK)');
  });
});

/**
 * audit R3 #197 — the health check compared a tool COUNT and each tool's
 * truthiness. Compensating errors (one register function contributing zero, a
 * second contributing two) keep the total right, and a name is not checked at
 * all. The expectation is read from `TOOL_REGISTRY`, the same source
 * `EXPECTED_TOOL_COUNT` derives from, so nothing is restated.
 */
describe('--health-check verifies the tool surface by NAME', () => {
  it('reports exactly the registry names, in the registry order', () => {
    const report = JSON.parse(run('--health-check').stdout);
    expect(report.tools).toEqual(TOOL_REGISTRY.map((t) => t.name));
    expect(report.toolCount).toBe(EXPECTED_TOOL_COUNT);
  });

  it('is a set comparison, not a count — the gate names missing and unexpected tools', () => {
    const source = readFileSync(HEALTH_CHECK, 'utf8');
    expect(source).toContain('Tool surface mismatch');
    expect(source).toContain('Duplicate tool registration(s)');
    expect(source).toContain('TOOL_REGISTRY.map((t) => t.name as string)');
  });
});

/**
 * audit R3 #194 — `VERSION` is one of FIVE hand-maintained copies kept in step
 * by a `sed` in `.claude/rules/40-version-bump.md`. The rule's own "Common
 * Mistakes" list names forgetting the MCP files, and nothing checked it: the
 * sidecar then reports a version the app does not have, which is exactly what
 * `--health-check` exists to surface. The literal is deliberately NOT injected
 * at build time (`pnpm build` is plain `tsc`); this makes the copy checkable
 * instead.
 */
describe('the five version literals agree', () => {
  const REPO = path.resolve(PKG, '..', '..');
  const read = (rel: string) => readFileSync(path.join(REPO, rel), 'utf8');
  const jsonVersion = (rel: string) => JSON.parse(read(rel)).version as string;

  it.each([
    ['package.json', () => jsonVersion('package.json')],
    ['src-tauri/tauri.conf.json', () => jsonVersion('src-tauri/tauri.conf.json')],
    ['server/mcp/package.json', () => jsonVersion('server/mcp/package.json')],
    ['src-tauri/Cargo.toml', () => /^version = "([^"]+)"/m.exec(read('src-tauri/Cargo.toml'))?.[1]],
  ])('%s matches server/mcp/src/cli.ts', (_label, get) => {
    expect(get()).toBe(VERSION);
  });

  it('reads a real semver from every source (a parity test over undefined proves nothing)', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
