// WI-15 — the MCP contract generator: determinism, fidelity, and fail-closed guards.
/**
 * The generator is what makes `operationSchemas.ts` authoritative instead of
 * merely first among equals, so its own failure modes matter:
 *
 *   - nondeterministic output (object-key iteration order) would make the
 *     drift check flap forever and train everyone to ignore it;
 *   - a partially-written file after a failed run would PASS the next
 *     `--check`, freezing a truncated contract into the repo;
 *   - flattened optionality would silently turn a required field into an
 *     optional one on the webview side.
 *
 * Real zod schemas, the real generator, the real CLI for the exit-code legs.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { generate, describeFields, tsTypeOf } from '../../../scripts/gen-mcp-contracts.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIDECAR_ROOT = resolve(HERE, '../../..');
const REPO_ROOT = resolve(SIDECAR_ROOT, '../..');
const GENERATOR = resolve(SIDECAR_ROOT, 'scripts/gen-mcp-contracts.ts');
const TSX = resolve(REPO_ROOT, 'node_modules/.bin/tsx');

const postureFor = (operation: string): string =>
  operation.startsWith('vmark.session.') ? 'strip-and-log' : 'reject';

const fixture = (extra: Record<string, z.ZodType> = {}) => ({
  BRIDGE_OPERATION_SCHEMAS: {
    'vmark.session.get_state': z.object({ clientProtocol: z.string().optional() }),
    'vmark.document.write': z.object({
      tabId: z.string().optional(),
      content: z.string(),
      ...extra,
    }),
  },
  postureFor,
});

function runCli(args: string[]): { status: number; stderr: string } {
  try {
    execFileSync(TSX, [GENERATOR, ...args], { encoding: 'utf8', stdio: 'pipe', timeout: 60_000 });
    return { status: 0, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    return { status: failure.status ?? 1, stderr: failure.stderr ?? '' };
  }
}

describe('gen-mcp-contracts — determinism', () => {
  it('produces byte-identical output on repeated runs over the same schemas', () => {
    const first = generate(fixture());
    const second = generate(fixture());
    expect(second.sidecar).toBe(first.sidecar);
    expect(second.frontend).toBe(first.frontend);
  });

  it('is insensitive to the schema literal declaration order', () => {
    const ordered = generate(fixture());
    const reversed = generate({
      BRIDGE_OPERATION_SCHEMAS: {
        'vmark.document.write': z.object({ content: z.string(), tabId: z.string().optional() }),
        'vmark.session.get_state': z.object({ clientProtocol: z.string().optional() }),
      },
      postureFor,
    });
    expect(reversed.sidecar).toBe(ordered.sidecar);
    expect(reversed.frontend).toBe(ordered.frontend);
  });
});

describe('gen-mcp-contracts — fidelity', () => {
  it('an added schema field appears in both generated copies, named', () => {
    const before = generate(fixture());
    const after = generate(fixture({ save: z.boolean().optional() }));
    expect(before.frontend).not.toContain('save');
    expect(after.frontend).toContain('{ name: "save", optional: true, kind: "boolean" }');
    expect(after.sidecar).toContain('save?: boolean;');
  });

  it('keeps optionality: `?` in the type, `optional: true` in the manifest', () => {
    const generated = generate(fixture());
    expect(generated.sidecar).toContain('tabId?: string;');
    expect(generated.sidecar).toContain('content: string;');
    expect(generated.frontend).toContain('{ name: "tabId", optional: true, kind: "string" }');
    expect(generated.frontend).toContain('{ name: "content", optional: false, kind: "string" }');
  });

  it('emits the posture the schema module assigns, per operation', () => {
    const generated = generate(fixture());
    expect(generated.frontend).toContain('"vmark.session.get_state": "strip-and-log"');
    expect(generated.frontend).toContain('"vmark.document.write": "reject"');
  });

  it('renders the container types the contract actually uses', () => {
    expect(tsTypeOf(z.array(z.unknown()))).toBe('unknown[]');
    expect(tsTypeOf(z.record(z.string(), z.string()).optional())).toBe('Record<string, string>');
    expect(tsTypeOf(z.object({ b: z.boolean().optional(), a: z.number() }))).toBe(
      '{ a: number; b?: boolean }'
    );
    expect(describeFields(z.object({ b: z.string(), a: z.string().optional() }))).toEqual([
      { name: 'a', optional: true, kind: 'string', tsType: 'string' },
      { name: 'b', optional: false, kind: 'string', tsType: 'string' },
    ]);
  });

  it('refuses a construct it cannot render rather than emitting `any`', () => {
    expect(() => tsTypeOf(z.date())).toThrow(/unsupported zod type/);
  });
});

describe('gen-mcp-contracts — fail closed', () => {
  it('rejects a module that exports no schemas', () => {
    expect(() => generate({})).toThrow(/no BRIDGE_OPERATION_SCHEMAS/);
  });

  it('rejects an empty schema set', () => {
    expect(() => generate({ BRIDGE_OPERATION_SCHEMAS: {}, postureFor })).toThrow(
      /declares no operations/
    );
  });

  it('rejects a module with no posture function', () => {
    expect(() => generate({ BRIDGE_OPERATION_SCHEMAS: fixture().BRIDGE_OPERATION_SCHEMAS })).toThrow(
      /no postureFor/
    );
  });

  it('exits non-zero on an unloadable schema module and writes NO partial output', () => {
    const out = mkdtempSync(join(tmpdir(), 'vmark-contracts-'));
    const sidecar = join(out, 'bridgeRequests.ts');
    const frontend = join(out, 'bridgeContracts.ts');
    const result = runCli([
      '--schemas',
      resolve(SIDECAR_ROOT, '__tests__/fixtures/brokenSchemaModule.mjs'),
      '--out-sidecar',
      sidecar,
      '--out-frontend',
      frontend,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no files written');
    expect(existsSync(sidecar)).toBe(false);
    expect(existsSync(frontend)).toBe(false);
  });
});

describe('gen-mcp-contracts — drift check on the shipped tree', () => {
  it('reports the committed contracts as current', () => {
    expect(runCli(['--check']).status).toBe(0);
  });

  it('names the stale file when a generated copy is hand-edited', () => {
    const out = mkdtempSync(join(tmpdir(), 'vmark-contracts-'));
    const sidecar = join(out, 'bridgeRequests.ts');
    const frontend = join(out, 'bridgeContracts.ts');
    expect(runCli(['--out-sidecar', sidecar, '--out-frontend', frontend]).status).toBe(0);
    expect(readFileSync(sidecar, 'utf8')).toContain('BridgeRequest');

    // A hand-edit: the fixture output is now one operation short of the schemas.
    const stale = runCli([
      '--check',
      '--out-sidecar',
      join(out, 'missing.ts'),
      '--out-frontend',
      frontend,
    ]);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain('missing.ts');
    expect(stale.stderr).toContain('pnpm gen:mcp-contracts');
  });
});
