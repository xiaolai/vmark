// WI-AL1.1 — the identify frame carries the client's sessionLabel when it has one, under the camelCase key the Rust ClientIdentity reads
import { describe, it, expect, vi } from 'vitest';
import type WebSocket from 'ws';
import { sendIdentify } from '../../../src/bridge/wsProtocol.js';
import type { ClientIdentity, Logger } from '../../../src/bridge/websocketConfig.js';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function sentFrames(identity: ClientIdentity | null): unknown[] {
  const send = vi.fn();
  sendIdentify({ send } as unknown as WebSocket, identity, logger);
  return send.mock.calls.map(([raw]) => JSON.parse(String(raw)));
}

describe('sendIdentify', () => {
  it('sends the session label in the identify payload', () => {
    const frames = sentFrames({ name: 'codex-cli', version: '0.9', sessionLabel: 'nightly sweep' });
    expect(frames).toEqual([
      {
        id: 'identify',
        type: 'identify',
        payload: { name: 'codex-cli', version: '0.9', sessionLabel: 'nightly sweep' },
      },
    ]);
  });

  it('keeps a 128-byte CJK label byte-for-byte', () => {
    const label = `${'审'.repeat(42)}ab`;
    const [frame] = sentFrames({ name: 'claude-code', sessionLabel: label }) as [{ payload: { sessionLabel: string } }];
    expect(frame.payload.sessionLabel).toBe(label);
  });

  it('omits the key entirely when the client has no label', () => {
    const [frame] = sentFrames({ name: 'cursor' }) as [{ payload: Record<string, unknown> }];
    expect(frame.payload).not.toHaveProperty('sessionLabel');
  });

  it('sends nothing without an identity', () => {
    expect(sentFrames(null)).toEqual([]);
  });
});
