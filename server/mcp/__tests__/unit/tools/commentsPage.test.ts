// comments.list pages: every page of a maximum-size document fits the output bound whole (never the truncation envelope), following nextCursor returns every thread and reply exactly once and in order, a long thread continues across pages, a bad or stale cursor, or one from another document, is refused, a small list comes back unchanged, a cursor malformed in any field is refused, and an entry or page over the bound fails loud
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import type { BridgeResponse } from '../../../src/bridge/core-types.js';
import { VMarkMcpServer } from '../../../src/server.js';
import { registerCommentsTool } from '../../../src/tools/comments.js';
import { MAX_OUTPUT_BYTES, utf8ByteLength } from '../../../src/utils/toolOutput.js';
import { MockBridge } from '../../mocks/mockBridge.js';
import { toolJson, toolText } from '../../utils/toolResult.js';

type Entry = Record<string, unknown> & { comment: string; replies: Array<Record<string, unknown>> };
type Page = { doc: unknown; generation: unknown; threads: Entry[]; nextCursor?: string };

/** The journal's per-body limit, in UTF-8 bytes. */
const BODY_BYTES = 16 * 1024;
/** The journal's quote limit, in UTF-8 bytes. */
const QUOTE_BYTES = 4 * 1024;

/** `unit` repeated to at most `bytes` UTF-8 bytes. */
function text(unit: string, bytes: number): string {
  return unit.repeat(Math.floor(bytes / utf8ByteLength(unit)));
}

function thread(n: number, replies: number, body: string, quote = '第二段'): Entry {
  return {
    comment: `c${n}`,
    state: 'open',
    commentGen: String(n),
    revision: `r${n}`,
    creationRetained: true,
    quote,
    body,
    author: 'xl',
    caller: { kind: 'user' },
    replies: Array.from({ length: replies }, (_, i) => ({ reply: `p${n}-${i}`, body, author: 'agent', caller: { kind: 'agent' } })),
    anchor: { kind: 'resolved', from: 1, to: 4 },
  };
}

function harness(list: Page) {
  const bridge = new MockBridge();
  bridge.setResponseHandler('vmark.comments.list', (): BridgeResponse => ({ success: true, data: list }));
  const server = new VMarkMcpServer({ bridge });
  registerCommentsTool(server);
  return server;
}

/** Every page from the first, asserting each fits whole. */
async function allPages(server: VMarkMcpServer): Promise<Page[]> {
  const pages: Page[] = [];
  let cursor: string | undefined;
  do {
    const result = await server.callTool('comments', { action: 'list', ...(cursor ? { cursor } : {}) });
    expect(result.isError).toBeFalsy();
    const raw = toolText(result);
    expect(utf8ByteLength(raw)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    const page = JSON.parse(raw) as Page;
    expect(page).not.toHaveProperty('truncated');
    pages.push(page);
    cursor = page.nextCursor;
    expect(pages.length).toBeLessThan(500);
  } while (cursor);
  return pages;
}

/** The list the pages add up to: continuation parts folded into their thread. */
function reassemble(pages: Page[]): Entry[] {
  const out: Entry[] = [];
  for (const page of pages) {
    for (const part of page.threads) {
      const { repliesFrom, repliesTotal, continued, ...rest } = part;
      const last = out[out.length - 1];
      if (continued === true) {
        expect(last.comment).toBe(part.comment);
        expect(repliesFrom).toBe(last.replies.length);
        last.replies.push(...part.replies);
      } else {
        if (repliesFrom !== undefined) expect(repliesFrom).toBe(0);
        out.push({ ...rest, replies: [...part.replies] } as Entry);
      }
      if (repliesTotal !== undefined) expect(out[out.length - 1].replies.length).toBeLessThanOrEqual(Number(repliesTotal));
    }
  }
  return out;
}

describe('comments.list paging', () => {
  it('returns a small list unchanged, with no cursor', async () => {
    const list: Page = { doc: 'd1', generation: '3', threads: [thread(1, 2, '改成 “文档” 🙂')] };
    expect(toolJson(await harness(list).callTool('comments', { action: 'list' }))).toEqual(list);
  });

  it('pages a maximum-size document so every thread and reply comes back once', async () => {
    const cjk = text('文档审阅🙂', BODY_BYTES);
    const threads = [
      ...Array.from({ length: 997 }, (_, i) => thread(i + 1, 0, `note ${i}`)),
      thread(998, 200, cjk, text('引', 4096)),
      thread(999, 200, text('a', BODY_BYTES)),
      thread(1000, 3, 'tail'),
    ];
    const list: Page = { doc: 'd1', generation: '42', threads };
    const pages = await allPages(harness(list));
    expect(pages.length).toBeGreaterThan(80);
    for (const page of pages) expect([page.doc, page.generation]).toEqual(['d1', '42']);
    expect(reassemble(pages)).toEqual(threads);
    expect(pages.some((p) => p.threads.some((t) => t.continued === true && t.repliesTotal === 200))).toBe(true);
  });

  it('sends an entry no page could hold as JSON whole, its body base64-encoded', async () => {
    // Control characters escape to six bytes: a 16 KiB body is ~98 KB of
    // JSON and a 4 KiB quote ~25 KB; the body's base64 is ~22 KB, so the
    // entry fits with its quote left as text.
    const escaped = text('\u0001', BODY_BYTES);
    const quote = text('\u0002', QUOTE_BYTES);
    const list: Page = { doc: 'd1', generation: '1', threads: [thread(1, 1, escaped, quote), thread(2, 0, 'after')] };
    const parts = (await allPages(harness(list))).flatMap((p) => p.threads);
    const decoded = (b64: unknown) => Buffer.from(String(b64), 'base64').toString('utf8');
    expect(parts[0]).not.toHaveProperty('body');
    expect(decoded(parts[0].bodyBase64)).toBe(escaped);
    expect(parts[0].quote).toBe(quote);
    const reply = parts.flatMap((t) => t.replies)[0];
    expect(reply).toMatchObject({ reply: 'p1-0' });
    expect(decoded(reply.bodyBase64)).toBe(escaped);
    expect(parts[parts.length - 1]).toMatchObject({ comment: 'c2', body: 'after' });
    expect(parts[parts.length - 1]).not.toHaveProperty('bodyBase64');
  });

  it('refuses a cursor it never issued', async () => {
    const server = harness({ doc: 'd1', generation: '1', threads: [thread(1, 0, 'x')] });
    for (const cursor of ['not-a-cursor', Buffer.from('{"c":"c1","r":-1,"k":true}').toString('base64url'), Buffer.from('{"c":"c1","r":2,"k":false}').toString('base64url')]) {
      const result = await server.callTool('comments', { action: 'list', cursor });
      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain('cursor');
    }
  });

  it('refuses a cursor that names this document but is malformed in any other field', async () => {
    const server = harness({ doc: 'd1', generation: '1', threads: [thread(1, 2, 'x')] });
    const d = createHash('sha256').update(JSON.stringify('d1')).digest('base64url').slice(0, 22);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const bad = [
      'null',
      '"c1"',
      { d, c: '', r: 0, k: false },
      { d, c: 'c'.repeat(65), r: 0, k: false },
      { d, c: 7, r: 0, k: false },
      { d, c: 'c1', r: 1.5, k: true },
      { d, c: 'c1', r: '1', k: true },
      { d, c: 'c1', r: 0, k: 'yes' },
      { d, c: 'c1', r: 1, k: false },
    ];
    for (const value of bad) {
      const cursor = typeof value === 'string' ? Buffer.from(value).toString('base64url') : encode(value);
      const result = await server.callTool('comments', { action: 'list', cursor });
      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain('cursor is not one comments.list returned');
    }
    // The same fields, well formed, are accepted: the refusals above are the field checks.
    const ok = await server.callTool('comments', { action: 'list', cursor: encode({ d, c: 'c1', r: 1, k: true }) });
    expect(ok.isError).toBeFalsy();
    expect((toolJson(ok) as Page).threads[0]).toMatchObject({ comment: 'c1', continued: true, repliesFrom: 1 });
  });

  it('fails loud on an entry no page can hold even with its body base64-encoded', async () => {
    const huge = text('a', MAX_OUTPUT_BYTES);
    for (const entry of [thread(1, 0, 'x', huge), { ...thread(1, 0, 'x', huge), body: 5 }]) {
      const result = await harness({ doc: 'd1', generation: '1', threads: [entry as Entry] }).callTool('comments', { action: 'list' });
      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain('even with its body base64-encoded');
    }
  });

  it('fails loud, never truncates, when the page itself would exceed the output bound', async () => {
    const result = await harness({ doc: text('d', MAX_OUTPUT_BYTES), generation: '1', threads: [thread(1, 0, 'x')] }).callTool('comments', { action: 'list' });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('comments.list page is');
  });

  it('refuses a cursor whose thread is gone, telling the agent to list again', async () => {
    const big = text('a', BODY_BYTES);
    const first = await allPages(harness({ doc: 'd1', generation: '1', threads: [thread(1, 20, big)] }));
    const cursor = first[0].nextCursor;
    expect(cursor).toBeDefined();
    const result = await harness({ doc: 'd1', generation: '2', threads: [thread(2, 0, 'x')] }).callTool('comments', { action: 'list', cursor });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('STALE_COMMENT');
    expect(toolText(result)).toContain('without a cursor');
  });

  it('refuses a cursor from another document, even where the same thread id exists', async () => {
    const big = text('a', BODY_BYTES);
    const first = await allPages(harness({ doc: 'd1', generation: '1', threads: [thread(1, 20, big)] }));
    const cursor = first[0].nextCursor;
    expect(cursor).toBeDefined();
    for (const doc of ['d2', null]) {
      const result = await harness({ doc, generation: '1', threads: [thread(1, 20, big)] }).callTool('comments', { action: 'list', cursor });
      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain('STALE_COMMENT');
    }
  });

  it('fails loud when the app answers without a thread list', async () => {
    const result = await harness({ doc: 'd1', generation: '1' } as unknown as Page).callTool('comments', { action: 'list' });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('without a thread list');
  });

  it('refuses a cursor on any other action', async () => {
    const server = harness({ doc: 'd1', generation: '1', threads: [] });
    const result = await server.callTool('comments', { action: 'mark_addressed', commentId: 'c1', expectedCommentGen: '1', cursor: 'x' });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('cursor');
  });
});
