/**
 * The session label this sidecar declares at `identify` — where it comes
 * from and the rule it must pass.
 *
 * Source: the `VMARK_SESSION_LABEL` environment variable, set by the user in
 * the AI client's MCP config `env` block (beside `VMARK_MCP_TOKEN`). The MCP
 * protocol gives the sidecar no session name of its own — `clientInfo` names
 * the client, not the session — so an explicit, user-chosen variable is the
 * one source that means what it says. Absent or blank: no label.
 *
 * VMark uses the label to group an agent's edits for display. It is
 * UNTRUSTED there and decides nothing.
 *
 * The rule is VMark's (`src-tauri/src/mcp_bridge/attribution.rs`): at most
 * 128 UTF-8 bytes, no control characters and no bidirectional formatting
 * characters (marks, embeddings, overrides and isolates, which reorder how
 * the label and the text after it render), refused whole — never truncated or
 * stripped, because a silently altered label groups edits under a name nobody
 * chose. VMark refuses an identify carrying a bad label, display name and
 * all, so the sidecar applies the rule first: a refused label is dropped with
 * a warning and the identify still goes out without it.
 *
 * @coordinates-with utils/clientIdentity.ts (the identity the label joins)
 * @coordinates-with bridge/wsProtocol.ts (sends it in the identify frame)
 * @coordinates-with src-tauri/src/mcp_bridge/attribution.rs (the rule, enforced again on receipt)
 */

import type { ClientIdentity } from '../bridge/websocketConfig.js';

/** The environment variable carrying the session label. */
export const SESSION_LABEL_ENV = 'VMARK_SESSION_LABEL';

/** Largest accepted label in UTF-8 bytes; mirrors `MAX_SESSION_LABEL_BYTES` in Rust. */
export const MAX_SESSION_LABEL_BYTES = 128;

/**
 * Unicode general category Cc — what Rust's `char::is_control` matches — and
 * the bidirectional formatting characters `peer_text::is_bidi_formatting`
 * matches (the set the generated envelope fixture carries).
 */
const REFUSED_CHARACTER = /[\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

export type SessionLabelResult =
  | { readonly ok: true; readonly label: string | undefined }
  | { readonly ok: false; readonly error: string };

/**
 * Read and validate the label. The error text uses VMark's refusal codes, so
 * the warning names the same failure VMark would have answered with.
 */
export function readSessionLabel(env: NodeJS.ProcessEnv): SessionLabelResult {
  const label = env[SESSION_LABEL_ENV];
  if (label === undefined || label.trim() === '') return { ok: true, label: undefined };
  const size = Buffer.byteLength(label, 'utf8');
  if (size > MAX_SESSION_LABEL_BYTES) {
    return {
      ok: false,
      error: `SESSION_LABEL_TOO_LONG: ${SESSION_LABEL_ENV} is ${size} UTF-8 bytes; the limit is ${MAX_SESSION_LABEL_BYTES}`,
    };
  }
  if (REFUSED_CHARACTER.test(label)) {
    return {
      ok: false,
      error: `SESSION_LABEL_INVALID: ${SESSION_LABEL_ENV} must not contain control or bidirectional formatting characters`,
    };
  }
  return { ok: true, label };
}

/**
 * `identity` plus the configured label, as a new object. A refused label is
 * reported through `warn` and left out; the identity is otherwise unchanged.
 * The label comes from the environment alone: a `sessionLabel` the input
 * already carried is never passed through, so "no label" means none is sent.
 */
export function withSessionLabel(
  identity: ClientIdentity,
  env: NodeJS.ProcessEnv,
  warn: (message: string) => void,
): ClientIdentity {
  const { sessionLabel: _carried, ...rest } = identity;
  const result = readSessionLabel(env);
  if (!result.ok) {
    warn(`${result.error} — identifying without a session label`);
    return rest;
  }
  return result.label === undefined ? rest : { ...rest, sessionLabel: result.label };
}
