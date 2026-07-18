/**
 * Tests for the port-file discovery module (MCP-1 / MCP-5).
 *
 * The port file (`mcp-port`) is rewritten by VMark on every launch with a
 * fresh OS-assigned port and auth token, so the sidecar must re-read it on
 * every connection attempt — one startup read frozen as static config would
 * dial a dead port forever after a VMark restart.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs at module level so readPortFromFile reads controlled content
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from 'fs';

const mockReadFileSync = vi.mocked(readFileSync);

// Import after mock setup
import {
  readPortFromFile,
  getAuthToken,
  getPortFilePath,
  createAuthTokenResolver,
  parsePort,
} from '../../../src/utils/portFile.js';

/** Make the mocked readFileSync throw ENOENT (port file absent). */
function mockEnoent(): void {
  mockReadFileSync.mockImplementation(() => {
    const err = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    throw err;
  });
}

beforeEach(() => {
  // Reset the module-level cache: a failed read clears it.
  mockEnoent();
  readPortFromFile();
  vi.clearAllMocks();
});

describe('getPortFilePath', () => {
  it('points at the mcp-port file inside the app data directory', () => {
    const path = getPortFilePath();
    expect(path.endsWith('mcp-port')).toBe(true);
    expect(path.length).toBeGreaterThan('mcp-port'.length);
  });
});

describe('readPortFromFile', () => {
  it('reads the port file path returned by getPortFilePath', () => {
    mockReadFileSync.mockReturnValue('4123');
    readPortFromFile();
    expect(mockReadFileSync).toHaveBeenCalledWith(getPortFilePath(), 'utf8');
  });

  it('parses the legacy {port} format (no token)', () => {
    mockReadFileSync.mockReturnValue('4123');
    expect(readPortFromFile()).toBe(4123);
    expect(getAuthToken()).toBeUndefined();
  });

  it('parses the {port}:{token} format and caches the token', () => {
    mockReadFileSync.mockReturnValue('4123:secrettoken');
    expect(readPortFromFile()).toBe(4123);
    expect(getAuthToken()).toBe('secrettoken');
  });

  it('keeps colons inside the token', () => {
    mockReadFileSync.mockReturnValue('4123:abc:def');
    expect(readPortFromFile()).toBe(4123);
    expect(getAuthToken()).toBe('abc:def');
  });

  it('trims surrounding whitespace', () => {
    mockReadFileSync.mockReturnValue('  4123:tok\n');
    expect(readPortFromFile()).toBe(4123);
    expect(getAuthToken()).toBe('tok');
  });

  it.each([
    'abc',
    'abc:tok',
    '0',
    '-1',
    '65536',
    '',
    // Trailing garbage must be rejected — the old parseInt-based parser
    // accepted "4123junk" as 4123 (Codex finding 5).
    '4123junk',
    '4123junk:tok',
    '41.23',
    '4123 junk',
  ])('returns undefined for invalid content %j', (content) => {
    mockReadFileSync.mockReturnValue(content);
    expect(readPortFromFile()).toBeUndefined();
    expect(getAuthToken()).toBeUndefined();
  });

  it('returns undefined when the port file does not exist', () => {
    mockEnoent();
    expect(readPortFromFile()).toBeUndefined();
    expect(getAuthToken()).toBeUndefined();
  });

  it('clears the cached token when the file disappears', () => {
    mockReadFileSync.mockReturnValue('4123:tok');
    readPortFromFile();
    expect(getAuthToken()).toBe('tok');

    mockEnoent();
    expect(readPortFromFile()).toBeUndefined();
    expect(getAuthToken()).toBeUndefined();
  });

  it('refreshes the cached token on each read (VMark restart)', () => {
    mockReadFileSync.mockReturnValue('4123:oldtoken');
    readPortFromFile();
    expect(getAuthToken()).toBe('oldtoken');

    // VMark restarted: new port, new token
    mockReadFileSync.mockReturnValue('5124:newtoken');
    expect(readPortFromFile()).toBe(5124);
    expect(getAuthToken()).toBe('newtoken');
  });
});

describe('parsePort', () => {
  // ONE strict parser shared by the port-file reader and the --port CLI arg
  // (Codex finding 5): full-string digits only, range 1-65535.
  it.each([
    ['4123', 4123],
    ['1', 1],
    ['65535', 65535],
    ['04123', 4123], // leading zeros are still all-digits
  ])('accepts %j as %d', (raw, expected) => {
    expect(parsePort(raw)).toBe(expected);
  });

  it.each([
    '4123junk', // trailing garbage — parseInt would have accepted this
    'junk4123',
    '41.23',
    '+4123',
    '-4123',
    ' 4123',
    '4123 ',
    '4123\n',
    '0',
    '65536',
    '999999',
    '',
    'abc',
    '0x1F90',
    '4e3',
  ])('rejects %j', (raw) => {
    expect(parsePort(raw)).toBeUndefined();
  });
});

describe('createAuthTokenResolver', () => {
  it('without a static port serves the token from the last port-file read', () => {
    const resolver = createAuthTokenResolver(undefined);

    // The bridge's portResolver re-reads the file on each connect attempt,
    // which refreshes the cache this resolver serves from.
    mockReadFileSync.mockReturnValue('4123:tok1');
    readPortFromFile();
    expect(resolver()).toBe('tok1');

    mockReadFileSync.mockReturnValue('5124:tok2');
    readPortFromFile();
    expect(resolver()).toBe('tok2');
  });

  it('with a matching static port harvests the token by re-reading the file itself', () => {
    const warn = vi.fn();
    const resolver = createAuthTokenResolver(4123, warn);

    mockReadFileSync.mockReturnValue('4123:tok');
    expect(resolver()).toBe('tok');
    expect(warn).not.toHaveBeenCalled();
  });

  it('with a mismatched port file proceeds tokenless and warns once', () => {
    const warn = vi.fn();
    const resolver = createAuthTokenResolver(5000, warn);

    mockReadFileSync.mockReturnValue('4123:tok');
    expect(resolver()).toBeUndefined();
    expect(resolver()).toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('5000');
    expect(warn.mock.calls[0][0]).toContain('4123');
  });

  it('with no port file proceeds tokenless and warns once', () => {
    const warn = vi.fn();
    const resolver = createAuthTokenResolver(5000, warn);

    mockEnoent();
    expect(resolver()).toBeUndefined();
    expect(resolver()).toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('port file');
  });

  it('recovers the token once the port file catches up to the static port', () => {
    const warn = vi.fn();
    const resolver = createAuthTokenResolver(5000, warn);

    mockReadFileSync.mockReturnValue('4123:tok');
    expect(resolver()).toBeUndefined();

    // VMark restarted onto the requested port
    mockReadFileSync.mockReturnValue('5000:tok2');
    expect(resolver()).toBe('tok2');
  });
});
