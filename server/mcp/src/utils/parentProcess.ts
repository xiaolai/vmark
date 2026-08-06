/**
 * Cross-platform parent process name detection.
 *
 * Uses execFileSync with argument arrays (no shell involved) to prevent
 * command injection via crafted ppid values. On Windows the PID must be
 * embedded in the PowerShell -Command string (string-form -Command never
 * populates $args), so it is validated with Number.isInteger first —
 * integers cannot carry injection payloads.
 *
 * @coordinates-with cli.ts (detectClientIdentity)
 */

import { execFileSync } from 'child_process';

/**
 * Get the name of a process by its PID (cross-platform).
 *
 * - macOS/Linux: `ps -p <pid> -o comm=`
 * - Windows: PowerShell `Get-Process`
 *
 * Security: Uses execFileSync with argument arrays to prevent
 * command injection. On macOS/Linux the pid is passed as String(pid)
 * in an array element. On Windows it is validated as an integer and
 * only then embedded in the PowerShell command text (no shell is
 * involved — execFileSync spawns powershell.exe directly).
 *
 * @param pid - The process ID to look up. Defaults to process.ppid.
 * @param currentPlatform - The platform. Defaults to process.platform.
 * @returns The process name, or undefined if detection fails.
 */
export function getParentProcessName(
  pid?: number,
  currentPlatform?: string,
): string | undefined {
  try {
    const targetPid = pid ?? process.ppid;
    const plat = currentPlatform ?? process.platform;

    if (!targetPid) return undefined;

    if (plat === 'darwin' || plat === 'linux') {
      const result = execFileSync('ps', ['-p', String(targetPid), '-o', 'comm='], {
        encoding: 'utf8',
        timeout: 500,
      }).trim();
      return result || undefined;
    } else if (plat === 'win32') {
      // Use PowerShell — wmic is deprecated on Windows 11+.
      // String-form -Command never populates $args (arguments after the
      // command string are appended to the command text), so positional
      // passing always errored and detection silently returned undefined.
      // The PID must be embedded in the command string; validate it as an
      // integer first — integers cannot carry injection payloads.
      const pidNum = Number(targetPid);
      if (!Number.isInteger(pidNum)) return undefined;
      const result = execFileSync('powershell', [
        '-NoProfile', '-Command',
        `(Get-Process -Id ${pidNum}).ProcessName`,
      ], { encoding: 'utf8', timeout: 500 }).trim();
      return result || undefined;
    }
  } catch {
    // Ignore errors — parent process detection is best-effort
  }
  return undefined;
}
