/**
 * Quarantine writer for corrupt hot-exit payload fragments (WI-3).
 *
 * Purpose: preserve — never delete — any payload that failed schema
 * validation, by writing it next to the session file in the app-data dir.
 *
 * Key decisions:
 *   - Deterministic artifact name (content hash of the entries): re-running
 *     restore on the same corrupt input rewrites the SAME file, so
 *     quarantine is idempotent and can never grow without bound; a
 *     DIFFERENT corruption gets a different name, so an earlier artifact is
 *     never overwritten (preserve, never destroy).
 *   - SHA-256, truncated to 16 hex digits (audit 20260804-F13). The name was
 *     a 32-bit FNV-1a, which makes the second half of that sentence false:
 *     8 hex digits is a space small enough for two genuinely different corrupt
 *     payloads to collide, and a collision here OVERWRITES the earlier
 *     artifact — silently destroying the bytes this module exists to keep.
 *     64 bits removes that as a practical concern; the hash is a filename, not
 *     a security boundary, so the truncation is fine.
 *   - Never throws: callers decide what a failed write means (the session
 *     restore path aborts so the original file survives; the per-window
 *     context path is fire-and-forget cosmetics).
 *
 * @coordinates-with sessionSalvage.ts — produces the entries written here
 * @coordinates-with restartWithHotExit.ts — aborts restore on a failed write
 * @module services/persistence/hotExit/sessionQuarantine
 */
import { appDataDir, join } from "@tauri-apps/api/path";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { hotExitWarn } from "@/utils/debug";
import type { QuarantinedEntry } from "./sessionSalvage";

const ARTIFACT_PREFIX = "session.corrupt-";
/** Hex digits kept from the digest — 64 bits of filename. */
const NAME_HEX_LENGTH = 16;

/** SHA-256, hex-encoded. `crypto.subtle` is why this whole path is async. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function serializeEntries(entries: readonly QuarantinedEntry[]): string {
  return JSON.stringify(
    {
      entries: entries.map((entry) => ({
        path: entry.path,
        reason: entry.reason,
        payload: entry.raw,
      })),
    },
    null,
    2,
  );
}

/** Deterministic artifact file name for a set of quarantined entries. */
export async function quarantineArtifactName(
  entries: readonly QuarantinedEntry[],
): Promise<string> {
  const digest = await sha256Hex(serializeEntries(entries));
  return `${ARTIFACT_PREFIX}${digest.slice(0, NAME_HEX_LENGTH)}.json`;
}

/**
 * Persist quarantined entries next to the session file. Returns whether the
 * artifact was written; never throws (the failure is the caller's decision).
 */
export async function quarantineSessionEntries(
  entries: readonly QuarantinedEntry[],
): Promise<boolean> {
  if (entries.length === 0) return true;
  try {
    const dir = await appDataDir();
    const artifactPath = await join(dir, await quarantineArtifactName(entries));
    await writeTextFile(artifactPath, serializeEntries(entries));
    return true;
  } catch (error) {
    hotExitWarn("Failed to write hot-exit quarantine artifact:", error);
    return false;
  }
}
