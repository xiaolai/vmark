// WI-AL1.1 — the sidecar's session label: read from VMARK_SESSION_LABEL, validated by the Rust identify rule (≤ 128 UTF-8 bytes, no control characters), refused whole and never truncated or stripped
/**
 * Tests for `utils/sessionLabel.ts`.
 *
 * VMark refuses an identify whose label breaks its rule — and with it the
 * client's display name. So the sidecar applies the same rule first: a bad
 * label is dropped with a warning and the identify still goes out.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import {
  MAX_SESSION_LABEL_BYTES,
  SESSION_LABEL_ENV,
  readSessionLabel,
  withSessionLabel,
} from '../../../src/utils/sessionLabel.js';
import type { ClientIdentity } from '../../../src/bridge/websocketConfig.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
const env = (label: string | undefined) => (label === undefined ? {} : { [SESSION_LABEL_ENV]: label });

describe('readSessionLabel', () => {
  it('mirrors the Rust byte limit carried by the generated envelope fixture', () => {
    const fixture = JSON.parse(
      readFileSync(resolve(REPO_ROOT, 'src/test/fixtures/mcpRequestEnvelope.json'), 'utf8'),
    ) as { sessionLabelMaxBytes: number };
    expect(MAX_SESSION_LABEL_BYTES).toBe(fixture.sessionLabelMaxBytes);
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['blank', '  \t '],
  ])('treats an %s label as no label', (_name, value) => {
    expect(readSessionLabel(env(value))).toEqual({ ok: true, label: undefined });
  });

  it.each([
    ['ASCII', 'nightly sweep'],
    ['surrounding spaces, kept verbatim as Rust keeps them', '  review  '],
    ['RTL text', 'مراجعة الفصل'],
    ['a zero-width space (not a control character)', 'a​b'],
    ['CJK at exactly 128 bytes', `${'审'.repeat(42)}ab`],
    ['emoji at exactly 128 bytes', '🚀'.repeat(32)],
  ])('accepts %s unchanged', (_name, label) => {
    expect(bytes(label)).toBeLessThanOrEqual(MAX_SESSION_LABEL_BYTES);
    expect(readSessionLabel(env(label))).toEqual({ ok: true, label });
  });

  it.each([
    ['129 bytes of CJK', '审'.repeat(43)],
    ['132 bytes of emoji', '🚀'.repeat(33)],
    ['129 ASCII bytes', 'x'.repeat(129)],
  ])('refuses %s — counted in bytes, never truncated', (_name, label) => {
    const result = readSessionLabel(env(label));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/^SESSION_LABEL_TOO_LONG: /);
    expect(result.error).toContain(String(bytes(label)));
  });

  it.each([
    ['a newline', 'a\nb'],
    ['a tab', 'a\tb'],
    ['NUL', 'a\u0000b'],
    ['DEL', 'a\u007fb'],
    ['a C1 control (NEL)', 'a\u0085b'],
  ])('refuses %s — never stripped', (_name, label) => {
    const result = readSessionLabel(env(label));
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/^SESSION_LABEL_INVALID: /) });
  });
});

describe('readSessionLabel — bidirectional formatting characters', () => {
  const fixture = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'src/test/fixtures/mcpRequestEnvelope.json'), 'utf8'),
  ) as { bidiFormattingCodePoints: number[] };
  const bidi = fixture.bidiFormattingCodePoints.map(
    (cp) => [`U+${cp.toString(16).toUpperCase().padStart(4, '0')}`, String.fromCodePoint(cp)] as const,
  );

  it('reads the full Rust set from the generated fixture', () => {
    expect(bidi).toHaveLength(12);
  });

  it.each(bidi)('refuses %s — VMark would refuse the identify', (_name, c) => {
    const result = readSessionLabel(env(`review${c}gpj.md`));
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/^SESSION_LABEL_INVALID: /) });
  });

  it('refuses no other non-control character', () => {
    const set = new Set(fixture.bidiFormattingCodePoints);
    for (let cp = 0x20; cp <= 0x10ffff; cp++) {
      if ((cp >= 0xd800 && cp <= 0xdfff) || (cp >= 0x7f && cp <= 0x9f)) continue;
      const refused = !readSessionLabel(env(`a${String.fromCodePoint(cp)}b`)).ok;
      if (refused !== set.has(cp)) throw new Error(`U+${cp.toString(16)}: refused ${refused}`);
    }
  });
});

describe('withSessionLabel', () => {
  const base: ClientIdentity = { name: 'claude-code', version: '2.1', pid: 7, parentProcess: 'claude' };

  it('adds a valid label beside the guessed name, without touching the input', () => {
    const warn = vi.fn();
    const identity = withSessionLabel(base, env('审阅 pass'), warn);
    expect(identity).toEqual({ ...base, sessionLabel: '审阅 pass' });
    expect(base).not.toHaveProperty('sessionLabel');
    expect(warn).not.toHaveBeenCalled();
  });

  it('sends no sessionLabel key when none is configured', () => {
    const identity = withSessionLabel(base, {}, vi.fn());
    expect(identity).not.toHaveProperty('sessionLabel');
    expect(identity).toEqual(base);
  });

  it('drops a refused label with a warning and keeps the rest of the identity', () => {
    const warn = vi.fn();
    const identity = withSessionLabel(base, env('a\nb'), warn);
    expect(identity).toEqual(base);
    expect(identity).not.toHaveProperty('sessionLabel');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/SESSION_LABEL_INVALID/);
  });

  it.each([
    ['no label configured', {}],
    ['a blank label', { VMARK_SESSION_LABEL: '   ' }],
    ['a refused label', { VMARK_SESSION_LABEL: 'a\nb' }],
  ])('%s drops a label the input identity already carried', (_name, environment) => {
    const carried: ClientIdentity = { ...base, sessionLabel: 'stale' };
    const identity = withSessionLabel(carried, environment, vi.fn());
    expect(identity).not.toHaveProperty('sessionLabel');
    expect(identity).toEqual(base);
    expect(carried.sessionLabel).toBe('stale');
  });

  it('a valid label replaces one the input identity already carried', () => {
    const identity = withSessionLabel({ ...base, sessionLabel: 'stale' }, env('fresh'), vi.fn());
    expect(identity).toEqual({ ...base, sessionLabel: 'fresh' });
  });
});
