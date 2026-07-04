/**
 * Image Hash Utilities
 *
 * Compute SHA-256 hashes for image deduplication.
 * Uses Web Crypto API for hashing.
 */

import { asArrayBufferBacked } from "./binary";

/**
 * Compute SHA-256 hash of binary data.
 * Returns hex-encoded hash string.
 */
export async function computeDataHash(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", asArrayBufferBacked(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
