/**
 * The frontend half of the trusted HTML preview (issue #1273).
 *
 * Purpose: move a decision the user has already made across the IPC boundary,
 * and keep the session trust store in step with what the backend actually
 * holds. Everything that *decides* anything lives elsewhere — the UI decides
 * (by asking the user), and `trusted_html::state` enforces.
 *
 * One rule worth stating: **local trust is dropped even when the backend
 * revoke fails.** A revoke that half-succeeded must never leave the UI showing
 * "trusted", because the user has already been told the grant is gone. The
 * backend grant is memory-only and unreachable without its token, so the worst
 * case of a failed revoke is a resident document nothing can address.
 *
 * @module services/trustedHtml/trustedHtmlBridge
 */

import { invoke } from "@tauri-apps/api/core";
import { useHtmlTrustStore } from "@/stores/htmlTrustStore";

/**
 * Whether `token` has the shape the Rust side mints (the app's 64-char hex
 * secret).
 *
 * Not a security boundary — the registry lookup is authoritative — but it turns
 * a malformed response into a caller-side error rather than a blank pane. It
 * lives HERE, with the IPC boundary it describes, rather than in the rendering
 * adapter: a `services/` module may not depend on `lib/formats/adapters/`
 * (ADR-013 tiers), and the token's shape is a wire contract, not a view concern.
 */
function isTrustGrantToken(token: string): boolean {
  return /^[0-9a-f]{64}$/i.test(token);
}

/**
 * Authorize `html` for execution as `path`, and remember the grant.
 *
 * Rejects for a pathless (untitled) document: a grant with no file to attach
 * it to could never be revoked through the UI.
 */
export async function grantTrustedHtml(
  path: string | null,
  html: string,
): Promise<string> {
  if (!path) {
    throw new Error("cannot trust an unsaved document");
  }
  const token = await invoke<string>("trusted_html_grant", { html });
  if (!isTrustGrantToken(token)) {
    // The backend already minted a grant before returning this. Throwing
    // without revoking would abandon it: nothing else knows the token, and it
    // would occupy a MAX_GRANTS slot until the process exits.
    if (typeof token === "string" && token.length > 0) {
      await invoke("trusted_html_revoke", { token }).catch(() => {});
    }
    throw new Error("trusted_html_grant returned a malformed token");
  }
  useHtmlTrustStore.getState().grant(path, token);
  return token;
}

/** Replace the document behind a live grant — the preview's Reload action. */
export async function publishTrustedHtml(
  token: string,
  html: string,
): Promise<void> {
  await invoke("trusted_html_publish", { token, html });
}

/** Revoke one document's grant. Safe to call for an untrusted path. */
export async function revokeTrustedHtml(path: string | null): Promise<void> {
  const token = useHtmlTrustStore.getState().tokenFor(path);
  if (!token) return;
  useHtmlTrustStore.getState().revoke(path);
  try {
    await invoke("trusted_html_revoke", { token });
  } catch {
    // Local trust is already dropped; see the module note.
  }
}

// There is deliberately no `revokeAllTrustedHtml`. One existed, called by
// nothing, and its own comment claimed it ran on window teardown. Wiring it
// there would have been worse than leaving it dead: the backend command it
// called was process-global, so closing one window would have revoked every
// other window's trusted previews. See the lifetime note in
// `src-tauri/src/trusted_html/mod.rs` for the bound that is accepted instead.
