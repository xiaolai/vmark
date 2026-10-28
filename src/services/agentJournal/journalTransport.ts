/**
 * Journal transport — the one place the agent edit journal's clients reach
 * Tauri's `invoke`, so the test suite can stand an in-memory journal in at
 * the wire (`src/test/agentJournalFake.ts`) while the real request protocol,
 * reply validation and page registration run above it.
 *
 * @coordinates-with services/agentJournal/journalIpc.ts — its only caller
 * @module services/agentJournal/journalTransport
 */

import { invoke } from "@tauri-apps/api/core";

/** Invoke journal command `command` with `args`; the raw reply or rejection. */
export function invokeJournal(command: string, args: Record<string, unknown>): Promise<unknown> {
  return invoke<unknown>(command, args);
}
