/**
 * Additional coverage tests for restartWithHotExit
 *
 * Covers uncovered branches: restartWithHotExit function, formatTimestamp,
 * clearSessionFile, non-main window guard, incompatible version, multi-window restore,
 * invoke failure cleanup, sanitize timeout, and setupRestoreListeners edge cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Tauri APIs
const mockInvoke = vi.fn();
const mockListen = vi.fn();
const mockRelaunch = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
  emit: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: (...args: unknown[]) => mockRelaunch(...args),
}));

let currentWindowLabel = 'main';
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ label: currentWindowLabel }),
}));

vi.mock('../resilience/_hotExitRestore', () => ({
  restoreMainWindowState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/debug', () => ({
  hotExitLog: vi.fn(),
  hotExitWarn: vi.fn(),
  hotExitError: vi.fn(),
}));

import { restartWithHotExit, checkAndRestoreSession } from './restartWithHotExit';
import { HOT_EXIT_EVENTS, SCHEMA_VERSION } from './types';

// ---------------------------------------------------------------
// restartWithHotExit
// ---------------------------------------------------------------
describe('restartWithHotExit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('captures session then relaunches', async () => {
    mockInvoke.mockResolvedValueOnce({ windows: [{ window_label: 'main' }], vmark_version: '0.5.0' });
    mockRelaunch.mockResolvedValueOnce(undefined);

    await restartWithHotExit();

    expect(mockInvoke).toHaveBeenCalledWith('hot_exit_capture');
    expect(mockRelaunch).toHaveBeenCalled();
  });

  it('relaunches even if capture fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockInvoke.mockRejectedValueOnce(new Error('capture failed'));
    mockRelaunch.mockResolvedValueOnce(undefined);

    await restartWithHotExit();

    expect(mockRelaunch).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('relaunches when capture throws non-Error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockInvoke.mockRejectedValueOnce('string error');
    mockRelaunch.mockResolvedValueOnce(undefined);

    await restartWithHotExit();

    expect(mockRelaunch).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('throws when relaunch itself fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockInvoke.mockResolvedValueOnce({ windows: [], vmark_version: '0.5.0' });
    mockRelaunch.mockRejectedValueOnce(new Error('relaunch failed'));

    await expect(restartWithHotExit()).rejects.toThrow('relaunch failed');
    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------
// checkAndRestoreSession — additional branches
// ---------------------------------------------------------------
describe('checkAndRestoreSession — additional coverage', () => {
  let eventListeners: Map<string, (event: { payload: unknown }) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    currentWindowLabel = 'main';
    eventListeners = new Map();

    mockListen.mockImplementation((eventName: string, handler: (event: { payload: unknown }) => void) => {
      eventListeners.set(eventName, handler);
      return Promise.resolve(() => {
        eventListeners.delete(eventName);
      });
    });
  });

  it('returns false from non-main window', async () => {
    currentWindowLabel = 'doc-0';
    const result = await checkAndRestoreSession();
    expect(result).toBe(false);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('returns false and clears session for incompatible version', async () => {
    mockInvoke
      .mockResolvedValueOnce({
        version: 0, // incompatible
        timestamp: Date.now() / 1000,
        vmark_version: '0.1.0',
        windows: [],
      })
      .mockResolvedValueOnce(undefined); // clear_session

    const result = await checkAndRestoreSession();

    expect(result).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('hot_exit_clear_session');
  });

  it('uses multi-window restore for sessions with secondary windows', async () => {
    const session = {
      version: 2,
      timestamp: Date.now() / 1000,
      vmark_version: '0.5.0',
      windows: [
        { window_label: 'main', is_main_window: true, tabs: [] },
        { window_label: 'doc-0', is_main_window: false, tabs: [] },
      ],
    };

    mockInvoke
      .mockResolvedValueOnce(session) // inspect
      .mockResolvedValueOnce({ windows_created: ['doc-0'] }) // restore_multi
      .mockResolvedValueOnce(undefined); // clear_session

    const restorePromise = checkAndRestoreSession();

    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify multi-window restore was used (session passes through migration
    // and is bumped to current SCHEMA_VERSION before being sent)
    const migratedSession = { ...session, version: SCHEMA_VERSION };
    expect(mockInvoke).toHaveBeenCalledWith('hot_exit_restore_multi_window', { session: migratedSession });

    // Complete
    const completeHandler = eventListeners.get(HOT_EXIT_EVENTS.RESTORE_COMPLETE);
    completeHandler?.({ payload: {} });

    const result = await restorePromise;
    expect(result).toBe(true);
  });

  it('cleans up listeners and returns false when invoke fails', async () => {
    const session = {
      version: 2,
      timestamp: Date.now() / 1000,
      vmark_version: '0.5.0',
      windows: [{ window_label: 'main', is_main_window: true, tabs: [] }],
    };

    mockInvoke
      .mockResolvedValueOnce(session) // inspect
      .mockRejectedValueOnce(new Error('restore command failed')); // restore fails

    const result = await checkAndRestoreSession();

    // Should return false on invoke failure
    expect(result).toBe(false);
  });

  it('sanitizes invalid timeout to default', async () => {
    mockInvoke.mockResolvedValueOnce(null); // no session

    // NaN timeout should be sanitized to default
    const result = await checkAndRestoreSession(NaN);
    expect(result).toBe(false);
  });

  it('sanitizes negative timeout to default', async () => {
    mockInvoke.mockResolvedValueOnce(null);

    const result = await checkAndRestoreSession(-100);
    expect(result).toBe(false);
  });

  it('sanitizes zero timeout to default', async () => {
    mockInvoke.mockResolvedValueOnce(null);

    const result = await checkAndRestoreSession(0);
    expect(result).toBe(false);
  });

  it('returns false when outer try/catch catches an error', async () => {
    // Make invoke throw for inspect
    mockInvoke.mockRejectedValueOnce(new Error('network error'));

    const result = await checkAndRestoreSession();
    expect(result).toBe(false);
  });

  it('handles clear session failure gracefully', async () => {
    const session = {
      version: 0, // incompatible — triggers clearSessionFile
      timestamp: Date.now() / 1000,
      vmark_version: '0.1.0',
      windows: [],
    };

    mockInvoke
      .mockResolvedValueOnce(session) // inspect
      .mockRejectedValueOnce(new Error('clear failed')); // clear fails

    const result = await checkAndRestoreSession();
    expect(result).toBe(false);
    // Should not throw
  });

  it('migrates v1 session to current schema before restoring', async () => {
    const v1Session = {
      version: 1,
      timestamp: Date.now() / 1000,
      vmark_version: '0.3.0',
      windows: [{ window_label: 'main', is_main_window: true, tabs: [] }],
    };

    mockInvoke
      .mockResolvedValueOnce(v1Session) // inspect
      .mockResolvedValueOnce(undefined) // restore
      .mockResolvedValueOnce(undefined); // clear_session

    const restorePromise = checkAndRestoreSession();

    await new Promise(resolve => setTimeout(resolve, 50));

    // Session should be migrated to current SCHEMA_VERSION
    const restoreCall = mockInvoke.mock.calls.find(c => c[0] === 'hot_exit_restore');
    expect(restoreCall?.[1]?.session?.version).toBe(SCHEMA_VERSION);

    const completeHandler = eventListeners.get(HOT_EXIT_EVENTS.RESTORE_COMPLETE);
    completeHandler?.({ payload: {} });

    const result = await restorePromise;
    expect(result).toBe(true);
  });

  it('handles double-resolve in setupRestoreListeners (both events fire)', async () => {
    const session = {
      version: 2,
      timestamp: Date.now() / 1000,
      vmark_version: '0.5.0',
      windows: [{ window_label: 'main', is_main_window: true, tabs: [] }],
    };

    mockInvoke
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const restorePromise = checkAndRestoreSession();

    await new Promise(resolve => setTimeout(resolve, 50));

    // Fire complete
    const completeHandler = eventListeners.get(HOT_EXIT_EVENTS.RESTORE_COMPLETE);
    completeHandler?.({ payload: {} });

    // Fire failed after complete (should be ignored due to resolved guard)
    const failedHandler = eventListeners.get(HOT_EXIT_EVENTS.RESTORE_FAILED);
    failedHandler?.({ payload: { error: 'late error' } });

    const result = await restorePromise;
    expect(result).toBe(true);
  });

  it('formats valid timestamp in log output', async () => {
    const session = {
      version: 2,
      timestamp: 1700000000, // valid timestamp
      vmark_version: '0.5.0',
      windows: [{ window_label: 'main', is_main_window: true, tabs: [] }],
    };

    mockInvoke
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const restorePromise = checkAndRestoreSession();

    await new Promise(resolve => setTimeout(resolve, 50));

    const completeHandler = eventListeners.get(HOT_EXIT_EVENTS.RESTORE_COMPLETE);
    completeHandler?.({ payload: {} });

    await restorePromise;
    // No assertions beyond not throwing - the timestamp formatting is exercised
  });

  it('handles session with invalid timestamp', async () => {
    const session = {
      version: 2,
      timestamp: -1, // invalid
      vmark_version: '0.5.0',
      windows: [{ window_label: 'main', is_main_window: true, tabs: [] }],
    };

    mockInvoke
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const restorePromise = checkAndRestoreSession();

    await new Promise(resolve => setTimeout(resolve, 50));

    const completeHandler = eventListeners.get(HOT_EXIT_EVENTS.RESTORE_COMPLETE);
    completeHandler?.({ payload: {} });

    await restorePromise;
    // Should not throw on invalid timestamp
  });

  it('handles session with NaN timestamp (formatTimestamp catch branch)', async () => {
    const session = {
      version: 2,
      timestamp: NaN, // triggers !Number.isFinite check in formatTimestamp
      vmark_version: '0.5.0',
      windows: [{ window_label: 'main', is_main_window: true, tabs: [] }],
    };

    mockInvoke
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const restorePromise = checkAndRestoreSession();

    await new Promise(resolve => setTimeout(resolve, 50));

    const completeHandler = eventListeners.get(HOT_EXIT_EVENTS.RESTORE_COMPLETE);
    completeHandler?.({ payload: {} });

    await restorePromise;
    // formatTimestamp returns "invalid(NaN)" without throwing
  });

  it('handles session with Infinity timestamp (formatTimestamp catch branch)', async () => {
    const session = {
      version: 2,
      timestamp: Infinity, // triggers !Number.isFinite check
      vmark_version: '0.5.0',
      windows: [{ window_label: 'main', is_main_window: true, tabs: [] }],
    };

    mockInvoke
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const restorePromise = checkAndRestoreSession();

    await new Promise(resolve => setTimeout(resolve, 50));

    const completeHandler = eventListeners.get(HOT_EXIT_EVENTS.RESTORE_COMPLETE);
    completeHandler?.({ payload: {} });

    await restorePromise;
  });
});
