/**
 * API-key secret bridge — OS keychain access for AI-provider API keys.
 *
 * RW-16 (L8): API keys were persisted in plaintext via `tauri-plugin-store`
 * (and previously localStorage). This module routes every key read/write
 * through the `set_secret` / `get_secret` / `delete_secret` Tauri commands,
 * which use the OS keychain (macOS Keychain, Windows Credential Manager,
 * Linux Secret Service). The keychain is the source of truth for persistence;
 * the Zustand store holds keys only in memory for the active session.
 *
 * Purpose: per-provider keychain helpers plus a one-time, idempotent
 * migration that lifts any plaintext keys still in the persisted store into
 * the keychain.
 *
 * @coordinates-with src/stores/aiStore/provider.ts — sole consumer
 * @coordinates-with src-tauri/src/secure_store.rs — command backend
 * @module services/secrets/apiKeySecrets
 */

// audit-fix — distinguish present/absent/error keychain reads so transient
// read failures can no longer masquerade as an unset key (the root cause of
// the migration-clobber, key-drop, and silent-write-loss bugs).
import { invoke } from "@tauri-apps/api/core";
import { aiProviderLog, aiProviderWarn } from "@/utils/debug";

/** Keychain key namespace for a provider's API key. Flat, stable, per-type. */
export function apiKeySecretId(providerType: string): string {
  return `apikey.${providerType}`;
}

/**
 * Strict tri-state result of a keychain read.
 *
 * - `present` — the keychain returned a value (`value` is it).
 * - `absent`  — the keychain has no entry (the command returned `null`).
 * - `error`   — the read itself failed (locked keychain, IPC error, etc.).
 *               `value` is `""` and MUST NOT be treated as "unset".
 */
export type ApiKeyReadStatus = "present" | "absent" | "error";
export interface ApiKeyReadResult {
  status: ApiKeyReadStatus;
  value: string;
}

/**
 * audit-fix — strict reader: tells present / absent / error apart.
 *
 * The `get_secret` Tauri command returns `Option<String>` (null = absent) and
 * rejects on a genuine failure. Callers that must not conflate "no entry" with
 * "read failed" (migration, hydration) MUST use this, not `getApiKey`.
 */
export async function readApiKey(
  providerType: string
): Promise<ApiKeyReadResult> {
  try {
    const value = await invoke<string | null>("get_secret", {
      key: apiKeySecretId(providerType),
    });
    return value === null || value === undefined
      ? { status: "absent", value: "" }
      : { status: "present", value };
  } catch (e) {
    aiProviderWarn("readApiKey failed:", providerType, e);
    return { status: "error", value: "" };
  }
}

/**
 * Read one provider's API key from the keychain. Returns "" when unset OR on a
 * read error — convenience for non-migration callers that only need the value.
 * Code that must distinguish "unset" from "read failed" must use `readApiKey`.
 */
export async function getApiKey(providerType: string): Promise<string> {
  return (await readApiKey(providerType)).value;
}

/**
 * Write one provider's API key to the keychain. An empty value deletes the
 * entry so a cleared field doesn't leave a stale secret behind.
 *
 * audit-fix — returns `true` on success, `false` when the keychain write/delete
 * fails, so callers can surface the failure instead of silently losing a key.
 */
export async function setApiKey(
  providerType: string,
  value: string
): Promise<boolean> {
  const key = apiKeySecretId(providerType);
  try {
    if (value) {
      await invoke("set_secret", { key, value });
    } else {
      await invoke("delete_secret", { key });
    }
    return true;
  } catch (e) {
    aiProviderWarn("setApiKey failed:", providerType, e);
    return false;
  }
}

/** Delete one provider's API key from the keychain (idempotent). */
export async function deleteApiKey(providerType: string): Promise<void> {
  try {
    await invoke("delete_secret", { key: apiKeySecretId(providerType) });
  } catch (e) {
    aiProviderWarn("deleteApiKey failed:", providerType, e);
  }
}

/** Bulk-read API keys for the given provider types. Omits unset/errored keys. */
export async function loadApiKeys(
  providerTypes: string[]
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    providerTypes.map(
      async (type) => [type, await getApiKey(type)] as const
    )
  );
  return Object.fromEntries(entries.filter(([, key]) => key !== ""));
}

/**
 * audit-fix — status-aware bulk read: returns the full tri-state result per
 * type so the caller can tell "no keychain entry" (absent → safe to clear the
 * in-memory key) from "read failed" (error → preserve whatever is in memory,
 * never overwrite a live key with "").
 */
export async function loadApiKeysWithStatus(
  providerTypes: string[]
): Promise<Record<string, ApiKeyReadResult>> {
  const entries = await Promise.all(
    providerTypes.map(
      async (type) => [type, await readApiKey(type)] as const
    )
  );
  return Object.fromEntries(entries);
}

/**
 * One-time, idempotent migration of plaintext API keys into the keychain.
 *
 * `legacy` is the `{ type → apiKey }` map recovered from the old plaintext
 * persisted blob (tauri-plugin-store / localStorage). For each non-empty
 * legacy key, migrate it ONLY when the strict pre-check reports the keychain
 * slot is ABSENT. A PRESENT slot already wins (never clobber a newer value);
 * an ERROR slot is skipped entirely (keep the plaintext, don't touch the
 * keychain) — audit-fix: a transient read error must never bypass the
 * no-clobber guard and overwrite a live secret with stale plaintext.
 *
 * Returns the set of provider types that were migrated, so the caller can
 * confirm the move before clearing the plaintext source. Never throws — a
 * keychain failure leaves the legacy value in memory rather than losing it.
 */
export async function migrateLegacyApiKeys(
  legacy: Record<string, string>
): Promise<string[]> {
  const migrated: string[] = [];
  for (const [type, value] of Object.entries(legacy)) {
    if (!value) continue;
    // audit-fix — strict tri-state pre-check. Only ABSENT is safe to write.
    const pre = await readApiKey(type);
    if (pre.status === "present") continue; // keychain already wins
    if (pre.status === "error") {
      // Read failed — we cannot prove the slot is empty, so a write here might
      // clobber a live secret. Skip; the plaintext value stays in memory.
      aiProviderWarn("Migration pre-check read failed, keeping plaintext:", type);
      continue;
    }
    try {
      await invoke("set_secret", {
        key: apiKeySecretId(type),
        value,
      });
      // Confirm the write landed before declaring success, so we never
      // report a key as migrated (and let the caller clear plaintext) when
      // the keychain silently rejected it.
      const verify = await readApiKey(type);
      if (verify.status === "present" && verify.value === value) {
        migrated.push(type);
        aiProviderLog("Migrated API key to keychain:", type);
      } else {
        aiProviderWarn("Migration verify mismatch, keeping plaintext:", type);
      }
    } catch (e) {
      aiProviderWarn("Migration failed, keeping plaintext:", type, e);
    }
  }
  return migrated;
}
