/**
 * Output-bound tests (WI-10.3, round-2 audit findings 1/2/3/7/9).
 *
 * Before the bound existed, the sidecar shipped whole documents in one text
 * block. Round 1 added the bound; the round-2 audit found three defects in it:
 *
 *  1. `text.slice(0, limit)` bisected UTF-16 surrogate pairs, so an emoji or
 *     any non-BMP character sitting on the cut point came out corrupted.
 *  2. The text block and `structuredContent` disagreed when truncated — the
 *     text held partial JSON plus prose, the structured channel held a
 *     different object. Clients feed BOTH to the model.
 *  3. The advertised 25,000-token cap was not enforced: 4-chars-per-token
 *     under-counts CJK and emoji badly, and the steering notice was appended
 *     OUTSIDE the budget, so real output could exceed the stated cap.
 */

import { describe, it, expect } from 'vitest';
import {
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_TOKENS,
  RECOVERY,
  applyOutputBound,
  jsonResult,
  sliceUtf8,
  structuredErrorResult,
  structuredJsonResult,
  utf8ByteLength,
} from '../../../src/utils/toolOutput.js';

/** A string survives a UTF-8 round trip only if it holds no lone surrogate. */
function isWellFormed(text: string): boolean {
  return Buffer.from(text, 'utf8').toString('utf8') === text;
}

/** Every truncated preview must be an uncorrupted prefix of the original. */
function expectCleanPrefix(preview: string, original: string): void {
  expect(isWellFormed(preview)).toBe(true);
  expect(preview.includes('�')).toBe(original.includes('�'));
  expect(original.startsWith(preview)).toBe(true);
}

describe('utf8ByteLength', () => {
  it.each([
    ['ascii', 'abc', 3],
    ['CJK', '汉字', 6],
    ['emoji (non-BMP)', '😀', 4],
    ['combining mark', 'é', 3],
    ['RTL', 'مرحبا', 10],
  ])('measures %s in UTF-8 bytes, not UTF-16 code units', (_label, text, bytes) => {
    expect(utf8ByteLength(text)).toBe(bytes);
  });
});

describe('sliceUtf8', () => {
  it('returns the whole string when it already fits', () => {
    expect(sliceUtf8('汉字', 6)).toBe('汉字');
  });

  it('returns empty for a non-positive budget', () => {
    expect(sliceUtf8('汉字', 0)).toBe('');
    expect(sliceUtf8('汉字', -5)).toBe('');
  });

  it.each([
    ['surrogate pair (emoji)', '😀😀😀'],
    ['CJK', '汉字漢字'],
    ['combining marks', 'ééé'],
    ['RTL', 'مرحبا بالعالم'],
  ])('never bisects a code point in %s, at any cut point', (_label, text) => {
    const total = utf8ByteLength(text);
    for (let budget = 0; budget <= total; budget++) {
      const cut = sliceUtf8(text, budget);
      expectCleanPrefix(cut, text);
      expect(utf8ByteLength(cut)).toBeLessThanOrEqual(budget);
    }
  });

  it('drops a trailing zero-width joiner rather than ending mid-sequence', () => {
    // 👨‍👩‍👦 is man ZWJ woman ZWJ boy. A cut landing right after a ZWJ leaves a
    // dangling joiner; the family emoji's first member is the honest prefix.
    const family = '👨‍👩‍👦';
    const cut = sliceUtf8(family, 7); // 4 bytes man + 3 bytes ZWJ
    expect(cut).toBe('👨');
  });
});

describe('applyOutputBound', () => {
  it('passes output through untouched when it fits', () => {
    const { text, envelope } = applyOutputBound('hello', RECOVERY.default);
    expect(text).toBe('hello');
    expect(envelope).toBeUndefined();
  });

  it('passes output exactly at the byte budget through untouched', () => {
    const exact = 'x'.repeat(MAX_OUTPUT_BYTES);
    const { text, envelope } = applyOutputBound(exact, RECOVERY.default);
    expect(text).toBe(exact);
    expect(envelope).toBeUndefined();
  });

  it('measures the budget in UTF-8 bytes, so CJK is bounded honestly', () => {
    // MAX_OUTPUT_BYTES/3 CJK characters are exactly at the budget; one more is
    // over it. Under the old chars-based bound this payload was ~3x the cap.
    const atCap = '汉'.repeat(MAX_OUTPUT_BYTES / 3);
    expect(applyOutputBound(atCap, RECOVERY.default).envelope).toBeUndefined();
    expect(applyOutputBound(atCap + '汉', RECOVERY.default).envelope).toBeDefined();
  });

  it('keeps the WHOLE response — notice included — inside the byte budget', () => {
    // The old implementation appended its notice AFTER slicing to the limit,
    // so the real output always exceeded the advertised cap.
    const { text } = applyOutputBound('汉'.repeat(80_000), RECOVERY.documentRead);
    expect(utf8ByteLength(text)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  });

  it('respects an explicit smaller limit, notice included', () => {
    const { text, envelope } = applyOutputBound('abcdef'.repeat(200), RECOVERY.default, 600);
    expect(envelope).toBeDefined();
    expect(utf8ByteLength(text)).toBeLessThanOrEqual(600);
  });

  it('emits the envelope even when the limit cannot fit the notice', () => {
    // Degenerate budget: the steering message is never itself truncated —
    // an agent that cannot see WHY the payload is missing is worse off.
    const { text, envelope } = applyOutputBound('abcdef', RECOVERY.default, 5);
    expect(envelope?.preview).toBe('');
    expect(envelope?.bytes_shown).toBe(0);
    expect(text).toContain('OUTPUT TRUNCATED');
  });

  it('cuts the preview on a character boundary for every script', () => {
    for (const unit of ['😀', '汉', 'é', 'مرحبا', 'a']) {
      const payload = unit.repeat(MAX_OUTPUT_BYTES) + unit;
      const { envelope } = applyOutputBound(payload, RECOVERY.documentRead);
      expect(envelope, unit).toBeDefined();
      expectCleanPrefix(envelope!.preview, payload);
    }
  });

  it('reports honest byte counts and the enforced token budget', () => {
    const payload = 'y'.repeat(MAX_OUTPUT_BYTES + 1);
    const { envelope } = applyOutputBound(payload, 'use selection.get instead');

    expect(envelope!.truncated).toBe(true);
    expect(envelope!.bytes_total).toBe(MAX_OUTPUT_BYTES + 1);
    expect(envelope!.bytes_shown).toBe(utf8ByteLength(envelope!.preview));
    expect(envelope!.bytes_shown).toBeLessThan(envelope!.bytes_total);
    expect(envelope!.truncation_note).toContain(String(MAX_OUTPUT_TOKENS));
    expect(envelope!.truncation_note).toContain(String(MAX_OUTPUT_BYTES));
    // Retrying the same call is the obvious wrong move; say so, and say how
    // to actually get the rest.
    expect(envelope!.truncation_note.toLowerCase()).toContain('do not retry this call unchanged');
    expect(envelope!.truncation_note).toContain('use selection.get instead');
  });

  it('serializes the envelope as parseable JSON, not partial JSON plus prose', () => {
    const { text, envelope } = applyOutputBound('z'.repeat(MAX_OUTPUT_BYTES + 10), RECOVERY.default);
    expect(JSON.parse(text)).toEqual(envelope);
  });
});

describe('RECOVERY hints', () => {
  it('publishes one actionable hint per unbounded surface', () => {
    for (const [key, hint] of Object.entries(RECOVERY)) {
      expect(hint.length, key).toBeGreaterThan(20);
      expect(hint.toLowerCase(), key).not.toBe('try again');
    }
    expect(Object.keys(RECOVERY)).toEqual(
      expect.arrayContaining([
        'default',
        'documentRead',
        'selectionGet',
        'browserRead',
        'sessionGetState',
      ]),
    );
  });

  it('never sells `clear: true` as the way to read the rest of the console', () => {
    // It returns the SAME oversized response and drains the buffer, destroying
    // every entry the agent could not see. That was destructive advice.
    const hint = RECOVERY.browserConsole;
    expect(hint).toMatch(/do not|never/i);
    expect(hint).toContain('clear');
    expect(hint.toLowerCase()).toContain('discard');
  });

  it('gives session.get_state a hint it can actually follow', () => {
    // `session.get_state` takes no tabId and has no pagination, so the default
    // "target a specific tabId" hint is impossible to act on.
    const hint = RECOVERY.sessionGetState;
    expect(hint).not.toContain('tabId');
    expect(hint.toLowerCase()).toMatch(/no pagination|cannot be narrowed|takes no arguments/);
  });
});

describe('jsonResult', () => {
  it('serializes with indentation and marks success', () => {
    const result = jsonResult({ a: 1 });
    expect(result.success).toBe(true);
    expect(result.content[0].text).toBe('{\n  "a": 1\n}');
    expect(result.structuredContent).toBeUndefined();
  });

  it('truncates an oversized payload into the envelope', () => {
    const result = jsonResult(
      { content: 'z'.repeat(MAX_OUTPUT_BYTES + 10) },
      RECOVERY.documentRead,
    );
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.truncated).toBe(true);
    expect(parsed.truncation_note).toContain(RECOVERY.documentRead);
    expect(utf8ByteLength(result.content[0].text as string)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  });

  it('does not throw on a payload JSON.stringify cannot represent', () => {
    const result = jsonResult(undefined);
    expect(typeof result.content[0].text).toBe('string');
  });
});

describe('structuredJsonResult', () => {
  it('mirrors the payload into structuredContent for machine consumers', () => {
    const data = { saved: true, current_revision: 'r2' };
    const result = structuredJsonResult(data);

    expect(JSON.parse(result.content[0].text as string)).toEqual(data);
    expect(result.structuredContent).toEqual(data);
  });

  it('wraps a non-object payload so structuredContent stays an object', () => {
    expect(structuredJsonResult('plain string').structuredContent).toEqual({
      result: 'plain string',
    });
  });

  it('wraps an array payload rather than emitting a non-object structuredContent', () => {
    expect(structuredJsonResult([1, 2]).structuredContent).toEqual({ result: [1, 2] });
  });

  it('puts the SAME truncation envelope in both channels', () => {
    // The two channels disagreed before: partial original JSON plus prose in
    // the text block, a different notice object in structuredContent. A client
    // reading both — and clients feed both to the model — saw two answers.
    const data = { content: '汉'.repeat(60_000) };
    const result = structuredJsonResult(data, RECOVERY.documentRead);

    expect(JSON.parse(result.content[0].text as string)).toEqual(result.structuredContent);
    expect(result.structuredContent).toMatchObject({ truncated: true });
    expect(String(result.structuredContent?.truncation_note)).toContain(RECOVERY.documentRead);
    // The full payload is NOT mirrored — the structured channel is bounded too.
    expect(result.structuredContent?.content).toBeUndefined();
    expect(utf8ByteLength(JSON.stringify(result.structuredContent))).toBeLessThanOrEqual(
      MAX_OUTPUT_BYTES,
    );
  });

  it('carries a preview so a truncated read is not a total loss', () => {
    const data = { content: `# Heading\n${'汉'.repeat(60_000)}` };
    const result = structuredJsonResult(data, RECOVERY.documentRead);
    expect(String(result.structuredContent?.preview)).toContain('# Heading');
  });
});

describe('structuredErrorResult', () => {
  it('carries machine-readable detail alongside the human message', () => {
    const result = structuredErrorResult('STALE: re-read and retry', {
      error: 'STALE',
      current_revision: 'r9',
    });
    expect(result.isError).toBe(true);
    expect(result.success).toBe(false);
    expect(result.content[0].text).toContain('STALE');
    expect(result.structuredContent).toEqual({ error: 'STALE', current_revision: 'r9' });
  });
});
