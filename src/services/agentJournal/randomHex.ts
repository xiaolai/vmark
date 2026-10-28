/**
 * Random hex — the one random source the journal's identities are minted
 * from: page identities, call ids and the window names' run token.
 *
 * Key decisions:
 *   - It answers `null` rather than throw when no random source works, so a
 *     module that mints at import keeps the page booting and each caller
 *     fails its own journal operation closed.
 *
 * @module services/agentJournal/randomHex
 */

/** `bytes` random bytes as lowercase hex, or `null` when no random source works. */
export function randomHex(bytes: number): string | null {
  try {
    return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}
