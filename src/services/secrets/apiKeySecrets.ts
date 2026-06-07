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

import { invoke } from "@tauri-apps/api/core";
import { aiProviderLog, aiProviderWarn } from "@/utils/debug";

/** Keychain key namespace for a provider's API key. Flat, stable, per-type. */
export function apiKeySecretId(providerType: string): string {
  return `apikey.${providerType}`;
}

/** Read one provider's API key from the keychain. Returns "" when unset. */
export async function getApiKey(providerType: string): Promise<string> {
  try {
    const value = await invoke<string | null>("get_secret", {
      key: apiKeySecretId(providerType),
    });
    return value ?? "";
  } catch (e) {
    aiProviderWarn("getApiKey failed:", providerType, e);
    return "";
  }
}

/**
 * Write one provider's API key to the keychain. An empty value deletes the
 * entry so a cleared field doesn't leave a stale secret behind.
 */
export async function setApiKey(
  providerType: string,
  value: string
): Promise<void> {
  const key = apiKeySecretId(providerType);
  try {
    if (value) {
      await invoke("set_secret", { key, value });
    } else {
      await invoke("delete_secret", { key });
    }
  } catch (e) {
    aiProviderWarn("setApiKey failed:", providerType, e);
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

/** Bulk-read API keys for the given provider types. */
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
 * One-time, idempotent migration of plaintext API keys into the keychain.
 *
 * `legacy` is the `{ type → apiKey }` map recovered from the old plaintext
 * persisted blob (tauri-plugin-store / localStorage). For each non-empty
 * legacy key whose keychain entry is still empty, write it to the keychain.
 * Keys already present in the keychain are never overwritten — that makes the
 * migration safe to run on every startup without clobbering newer values.
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
    try {
      const existing = await getApiKey(type);
      if (existing) continue; // keychain already wins — never clobber
      await invoke("set_secret", {
        key: apiKeySecretId(type),
        value,
      });
      // Confirm the write landed before declaring success, so we never
      // report a key as migrated (and let the caller clear plaintext) when
      // the keychain silently rejected it.
      const verify = await getApiKey(type);
      if (verify === value) {
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
