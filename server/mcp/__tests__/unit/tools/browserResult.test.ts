/**
 * Audit 2026-09-03 E-02 — every failure's structured data reaches the model.
 *
 * `toErrorResult` used to keep `data` only for an approval refusal; a TIMEOUT's
 * navigation ticket, an act's reason/candidates/url/generation and the retry
 * verb an open named were all dropped with the prose that promised them.
 */
import { describe, it, expect } from 'vitest';
import { toErrorResult } from '../../../src/tools/browserResult.js';

/** The first text block's text, or '' — typed so the assertions below are on a string. */
function textOf(res: { content: Array<{ type: string; text?: string }> }): string {
  const first = res.content[0];
  return first?.type === 'text' && typeof first.text === 'string' ? first.text : '';
}

function withData(message: string, data: unknown): Error & { data?: unknown } {
  const error = new Error(message) as Error & { data?: unknown };
  error.data = data;
  return error;
}

describe('toErrorResult', () => {
  it('renders an approval refusal with the retry verb the webview named', () => {
    const res = toErrorResult(
      withData('APPROVAL_REQUIRED', {
        needsApproval: true,
        operation: 'navigate',
        url: 'https://shop.example',
        tabId: 'tab-1',
        generation: 0,
        retry: { action: 'navigate', tabId: 'tab-1' },
      }),
    );
    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain("approval required: 'navigate' on https://shop.example");
    expect(text).toContain('retry with browser {action:"navigate", tabId:"tab-1"}');
    expect(text).toContain('a fresh open would create a new tab');
    expect(res.structuredContent).toMatchObject({ needsApproval: true, retry: { action: 'navigate' } });
  });

  it('falls back to a plain "try again" when no retry verb is named', () => {
    const res = toErrorResult(
      withData('APPROVAL_REQUIRED', { needsApproval: true, operation: 'click', url: 'https://a.example' }),
    );
    const text = textOf(res);
    expect(text).toContain('Once they have approved, try again.');
    expect(text).not.toContain('retry with browser');
  });

  it('passes a non-approval failure\'s data through as structuredContent and bounded text', () => {
    const res = toErrorResult(
      withData('TIMEOUT', { tabId: 'tab-1', navigationId: 'nav-9', loading: false }),
    );
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toEqual({ tabId: 'tab-1', navigationId: 'nav-9', loading: false });
    const text = textOf(res);
    expect(text.startsWith('TIMEOUT\n')).toBe(true);
    expect(text).toContain('"navigationId":"nav-9"');
  });

  it('truncates very large inline data but keeps the full object structured', () => {
    const big = { result: 'x'.repeat(10_000) };
    const res = toErrorResult(withData('click did not affect the target', big));
    const text = textOf(res);
    expect(text.length).toBeLessThan(4_200);
    expect(text.endsWith('…')).toBe(true);
    expect(res.structuredContent).toEqual(big);
  });

  it('survives unserializable data', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const res = toErrorResult(withData('boom', cyclic));
    const text = textOf(res);
    expect(text).toContain('[unserializable data]');
  });

  it('renders an error without data, and a non-Error, as their message alone', () => {
    expect(toErrorResult(new Error('plain')).content[0]).toEqual({ type: 'text', text: 'plain' });
    expect(toErrorResult('a string').content[0]).toEqual({ type: 'text', text: 'a string' });
    expect(toErrorResult(withData('arr', [1, 2])).content[0]).toEqual({ type: 'text', text: 'arr' });
  });
});
