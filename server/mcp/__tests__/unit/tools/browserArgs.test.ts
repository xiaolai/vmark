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
import {
  MAX_SCRIPT_BYTES,
  MAX_WAIT_MS,
  boundedStringArraySchema,
  boundedStringRecordSchema,
  boundedTextSchema,
  isNavigableUrl,
  readTimeout,
  scriptSchema,
  urlSchema,
} from '../../../src/tools/browserArgs.js';

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

// audit R3 #208 — every approval-facing payload reaches the same human dialog
// as a script, and had no bound at all: style maps, class arrays, a workflow's
// source and inputs, and the text an `act` types.
describe('bounded approval payloads', () => {
  const overCap = 'a'.repeat(MAX_SCRIPT_BYTES + 1);
  // CJK: 3 UTF-8 bytes per code unit, so this is under the code-unit `.max()`
  // and over the byte cap — the case a `.length` check alone would pass.
  const cjkOverCap = '字'.repeat(Math.ceil(MAX_SCRIPT_BYTES / 3) + 1);

  it('scriptSchema and boundedTextSchema are one bound under two names', () => {
    expect(scriptSchema('x').safeParse(overCap).success).toBe(false);
    expect(boundedTextSchema('x').safeParse(overCap).success).toBe(false);
    expect(boundedTextSchema('x').safeParse('ok').success).toBe(true);
    expect(boundedTextSchema('x').safeParse(undefined).success).toBe(true);
  });

  it('counts UTF-8 BYTES, not code units', () => {
    expect(cjkOverCap.length).toBeLessThanOrEqual(MAX_SCRIPT_BYTES);
    expect(boundedTextSchema('x').safeParse(cjkOverCap).success).toBe(false);
  });

  it('bounds a class array by each string AND by the whole collection', () => {
    const schema = boundedStringArraySchema('x');
    expect(schema.safeParse(['a', 'b']).success).toBe(true);
    expect(schema.safeParse([overCap]).success).toBe(false);
    // Many small strings must not evade the per-string cap by count.
    expect(schema.safeParse(Array.from({ length: 40_000 }, () => 'abcdef')).success).toBe(false);
  });

  it('bounds a style/inputs record by each value AND by the whole collection', () => {
    const schema = boundedStringRecordSchema('x');
    expect(schema.safeParse({ color: 'red' }).success).toBe(true);
    expect(schema.safeParse({ color: overCap }).success).toBe(false);
    expect(schema.safeParse(Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`k${i}`, 'vvvv']))).success).toBe(false);
  });
});

// audit R3 #209 — the advertised schema took ANY string while the description
// promised HTTP(S). Rust stays authoritative (navigation_policy.rs /
// ai_policy.rs); this is the same rule stated where a client can read it.
describe('urlSchema', () => {
  it.each(['http://example.com', 'https://example.com/a?b=c', 'HTTPS://EXAMPLE.COM', '  https://example.com  '])(
    'accepts %s',
    (url) => {
      expect(isNavigableUrl(url)).toBe(true);
      expect(urlSchema('x').safeParse(url).success).toBe(true);
    },
  );

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'about:blank',
    'data:text/html,<b>x</b>',
    '//example.com',
    'example.com',
    '',
    'https:\\\\example.com',
  ])('refuses %s', (url) => {
    expect(isNavigableUrl(url)).toBe(false);
    expect(urlSchema('x').safeParse(url).success).toBe(false);
  });

  it('leaves an omitted url absent', () => {
    expect(urlSchema('x').safeParse(undefined).success).toBe(true);
  });

  it('agrees with the Rust policy it mirrors', () => {
    const rust = readFileSync(resolve(TOOLS_DIR, '../../../../src-tauri/src/browser/navigation_policy.rs'), 'utf8');
    expect(rust).toContain('lower.starts_with("http://") || lower.starts_with("https://")');
    expect(rust).toContain("contains('\\\\')");
  });
});
