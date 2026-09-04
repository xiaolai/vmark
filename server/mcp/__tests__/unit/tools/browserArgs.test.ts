// Audit row #176 — the wait-bound contract has ONE check and ONE refusal text.
//
// `boundedTimeout` used to answer `number | undefined`, and "undefined" meant
// both "omitted" and "invalid". So every caller re-derived the difference
// (`args.timeoutMs !== undefined && wait === undefined`) and re-spelled the
// refusal — four copies of one contract across open, navigate, wait and
// wait_for. `readTimeout` answers an `ArgCheck`, like every other guard in
// `toolArgs.ts`/`browserArgs.ts`, so the callers cannot disagree about what a
// refusal is or how it reads.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_WAIT_MS, readTimeout } from '../../../src/tools/browserArgs.js';

const TOOLS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/tools');

const REFUSAL = `timeoutMs must be an integer from 1 to ${MAX_WAIT_MS}`;

describe('readTimeout — the one wait-bound check', () => {
  it('leaves an omitted timeout absent, so the app applies its default', () => {
    expect(readTimeout(undefined)).toEqual({ ok: true, value: undefined });
  });

  it.each([{ ms: 1 }, { ms: 250 }, { ms: MAX_WAIT_MS }])('accepts $ms (inclusive bounds)', ({ ms }) => {
    expect(readTimeout(ms)).toEqual({ ok: true, value: ms });
  });

  it.each([
    { value: 0 },
    { value: -1 },
    { value: MAX_WAIT_MS + 1 },
    { value: 1.5 },
    { value: Number.NaN },
    { value: Number.POSITIVE_INFINITY },
    { value: 'soon' },
    { value: '100' },
    { value: null },
    { value: true },
    { value: {} },
    { value: [] },
  ])('refuses $value with the one refusal text', ({ value }) => {
    expect(readTimeout(value)).toEqual({ ok: false, error: REFUSAL });
  });

  it('spells the live bound into the refusal, never a stale literal', () => {
    const refused = readTimeout(0);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toBe('timeoutMs must be an integer from 1 to 9000');
  });
});

describe('the timeout refusal has exactly one declaration site', () => {
  it('no tool handler re-spells it', () => {
    // The four handlers (open, navigate, wait, wait_for) must all get the text
    // FROM `readTimeout`; a copy in any of them is the drift this row closed.
    const owners = readdirSync(TOOLS_DIR)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => readFileSync(join(TOOLS_DIR, file), 'utf8').includes('timeoutMs must be an integer'));
    expect(owners).toEqual(['browserArgs.ts']);
  });
});
