/**
 * Tests for sidecar shutdown wiring (MCP-3).
 *
 * An orphaned sidecar (parent AI client crashed or closed the stdio
 * transport) must exit — reconnect timers would otherwise keep the process
 * alive forever, occupying a bridge slot in VMark.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
  createShutdownHandler,
  registerShutdownTriggers,
} from '../../../src/utils/shutdown.js';

type FakeProcess = EventEmitter & { stdin: EventEmitter };

function createFakeProcess(): FakeProcess {
  const proc = new EventEmitter() as FakeProcess;
  proc.stdin = new EventEmitter();
  return proc;
}

describe('createShutdownHandler', () => {
  it('runs cleanup then exits with code 0', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();

    const handler = createShutdownHandler(cleanup, exit);
    await handler();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('is double-invocation safe', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();

    const handler = createShutdownHandler(cleanup, exit);
    await Promise.all([handler(), handler(), handler()]);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('still exits 0 when cleanup rejects', async () => {
    const cleanup = vi.fn().mockRejectedValue(new Error('bridge already gone'));
    const exit = vi.fn();

    const handler = createShutdownHandler(cleanup, exit);
    await handler();

    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe('registerShutdownTriggers', () => {
  it.each(['SIGINT', 'SIGTERM'])('invokes the handler on %s', async (signal) => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const proc = createFakeProcess();

    registerShutdownTriggers(proc, createShutdownHandler(cleanup, exit));
    proc.emit(signal);

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it.each(['end', 'close'])(
    'invokes the handler on stdin %s (orphaned parent / transport closed)',
    async (event) => {
      const cleanup = vi.fn().mockResolvedValue(undefined);
      const exit = vi.fn();
      const proc = createFakeProcess();

      registerShutdownTriggers(proc, createShutdownHandler(cleanup, exit));
      proc.stdin.emit(event);

      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
      expect(cleanup).toHaveBeenCalledTimes(1);
    },
  );

  it('invokes the handler immediately when stdin already ended before registration', async () => {
    // Startup ordering hazard: if stdin hit EOF while the sidecar was still
    // connecting the bridge / MCP transport, the 'end'/'close' events fired
    // before any listener existed — the orphaned sidecar would never exit.
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const proc = createFakeProcess();
    (proc.stdin as EventEmitter & { readableEnded?: boolean }).readableEnded = true;

    registerShutdownTriggers(proc, createShutdownHandler(cleanup, exit));

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('invokes the handler immediately when stdin is already destroyed before registration', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const proc = createFakeProcess();
    (proc.stdin as EventEmitter & { destroyed?: boolean }).destroyed = true;

    registerShutdownTriggers(proc, createShutdownHandler(cleanup, exit));

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the handler when stdin is still open at registration', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const proc = createFakeProcess();

    registerShutdownTriggers(proc, createShutdownHandler(cleanup, exit));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cleanup).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('overlapping triggers shut down exactly once', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const proc = createFakeProcess();

    registerShutdownTriggers(proc, createShutdownHandler(cleanup, exit));
    // stdin EOF is typically followed by close, and the parent may also
    // signal — all in quick succession.
    proc.stdin.emit('end');
    proc.stdin.emit('close');
    proc.emit('SIGTERM');

    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
