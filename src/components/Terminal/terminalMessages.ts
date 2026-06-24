/**
 * terminalMessages
 *
 * Purpose: Localized terminal status lines written into the xterm buffer
 * (process-exit, restart/retry prompts, spawn failure, restart notice).
 * These are user-facing strings, so they go through i18n rather than being
 * hardcoded English. Written via i18n.t() because the producers are plain
 * functions/hooks, not React components.
 *
 * Each value is CRLF-framed for the terminal renderer. Keys live in the
 * `editor` namespace under `terminal.*`.
 *
 * @coordinates-with useTerminalSessions.ts — sole caller
 * @module components/Terminal/terminalMessages
 */
import i18n from "@/i18n";

/** "[Process exited with code N]" line (with surrounding CRLFs). */
export function processExitedLine(exitCode: number): string {
  return `\r\n${i18n.t("editor:terminal.processExited", { code: exitCode })}\r\n`;
}

/** "Press any key to restart..." prompt line. */
export function pressAnyKeyToRestartLine(): string {
  return `${i18n.t("editor:terminal.pressAnyKeyToRestart")}\r\n`;
}

/** "Failed to start shell: <error>" line (with surrounding CRLFs). */
export function failedToStartLine(error: string): string {
  return `\r\n${i18n.t("editor:terminal.failedToStart", { error })}\r\n`;
}

/** "Press any key to retry..." prompt line. */
export function pressAnyKeyToRetryLine(): string {
  return `${i18n.t("editor:terminal.pressAnyKeyToRetry")}\r\n`;
}

/** "Restarting shell..." notice line (with surrounding CRLFs). */
export function restartingLine(): string {
  return `\r\n${i18n.t("editor:terminal.restarting")}\r\n`;
}
