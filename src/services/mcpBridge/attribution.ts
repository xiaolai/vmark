/**
 * MCP request attribution — validates the `attribution` the Rust bridge puts
 * on every `mcp-bridge:request` event and returns it frozen.
 *
 * Purpose: the webview half of the request-envelope contract. The payload
 *   arrives over IPC typed only at compile time, so it is checked here
 *   field by field; `useMcpBridge` refuses a request whose attribution does
 *   not parse instead of dispatching it as some default principal.
 *
 * Key decisions:
 *   - Strict: every field must be present (Rust sends `null`, never omits),
 *     the principal must carry one of the four known tags, and an unknown tag
 *     — including a collapsed "unknown" — is a refusal.
 *   - `sessionLabel` is bounded in UTF-8 BYTES, the unit Rust enforces, so a
 *     CJK label is counted the same on both sides. Rust sends a blank label
 *     as null and refuses one with control or bidirectional formatting
 *     characters, so any of those arriving here is a wire violation and is
 *     refused too.
 *   - `displayName` mirrors Rust's identify sanitizer: name and version are
 *     stripped of control and bidirectional formatting characters and bounded
 *     (`peer_label`), the name never blank, so such a character, a blank or
 *     an over-long name is refused.
 *   - Every string must be well-formed UTF-16: a lone surrogate cannot come
 *     from a Rust string, and would later make `encodeURIComponent` throw.
 *   - The result is a fresh, deep-frozen object, so a write context built from
 *     it cannot be edited by a handler.
 *
 * @coordinates-with src-tauri/src/mcp_bridge/attribution.rs — the Rust source of the wire shape
 * @coordinates-with src/test/fixtures/mcpRequestEnvelope.json — the Rust-generated parity fixture
 * @coordinates-with hooks/useMcpBridge.ts — the one caller
 * @coordinates-with services/mcpBridge/connectionClosed.ts — reuses the connection-id check
 * @module services/mcpBridge/attribution
 */

import type { McpAttribution, McpPrincipal } from "./types";

/** Largest accepted session label in UTF-8 bytes; mirrors Rust's constant. */
export const MAX_SESSION_LABEL_BYTES = 128;

/** Rust's `peer_text::MAX_PEER_TEXT`: characters of a peer label kept. */
const MAX_PEER_LABEL_CHARS = 120;
/** Longest `ClientIdentity::display_name` Rust composes, in characters: a
 *  bounded name and version (each `peer_label`, so up to 120 characters
 *  plus the `…` cut marker) joined by " v". */
const MAX_DISPLAY_NAME_CHARS = 2 * (MAX_PEER_LABEL_CHARS + 1) + 2;

/** A version-4, RFC 4122-variant UUID as Rust's `Uuid::hyphenated()` writes
 *  it — the only kind `mint_connection_id` (`Uuid::new_v4`) produces. */
const CONNECTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** True for a connection id in the one form Rust sends (lower-case,
 *  hyphenated, version 4, RFC 4122 variant). */
export function isMcpConnectionId(value: unknown): value is string {
  return typeof value === "string" && CONNECTION_ID.test(value);
}

const utf8 = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read an OWN property, so a prototype cannot supply a field. */
function own(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** A lone surrogate: a UTF-16 string no Rust `String` could have produced. */
const LONE_SURROGATE = /\p{Cs}/u;
/**
 * Rust's `char::is_control` (general category Cc), or one of Unicode's
 * bidirectional formatting characters (`peer_text::is_bidi_formatting`: marks,
 * embeddings, overrides, isolates and their pops). Rust refuses a session
 * label with either and strips both from a display name, so neither arrives.
 */
const REFUSED_CHARACTER = /[\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
/** Rust's `str::trim` strips `White_Space`; a label of only that is blank. */
const BLANK = /^\p{White_Space}*$/u;

function isWireString(value: unknown): value is string {
  return typeof value === "string" && !LONE_SURROGATE.test(value);
}

/** A label Rust's `validate_session_label` would have let through, or null. */
function isWireSessionLabel(value: unknown): value is string | null {
  if (value === null) return true;
  if (!isWireString(value) || BLANK.test(value) || REFUSED_CHARACTER.test(value)) return false;
  return utf8.encode(value).length <= MAX_SESSION_LABEL_BYTES;
}

/** A display name Rust's identify sanitizer could have produced, or null:
 *  free of control and bidi formatting characters, not blank, within the
 *  composed bound (counted in characters, Rust's unit there). */
function isWireDisplayName(value: unknown): value is string | null {
  if (value === null) return true;
  if (!isWireString(value) || BLANK.test(value) || REFUSED_CHARACTER.test(value)) return false;
  return [...value].length <= MAX_DISPLAY_NAME_CHARS;
}

function parsePrincipal(raw: unknown): McpPrincipal | null {
  if (!isRecord(raw)) return null;
  switch (own(raw, "kind")) {
    case "anonymous":
      return Object.freeze({ kind: "anonymous" });
    case "unrecognized":
      return Object.freeze({ kind: "unrecognized" });
    case "ambiguous": {
      const providers = own(raw, "providers");
      if (!Array.isArray(providers) || providers.length < 2) return null;
      if (!providers.every((p): p is string => isWireString(p) && p !== "")) return null;
      return Object.freeze({ kind: "ambiguous", providers: Object.freeze([...providers]) });
    }
    case "provider": {
      const providerId = own(raw, "providerId");
      if (!isWireString(providerId) || providerId === "") return null;
      return Object.freeze({ kind: "provider", providerId });
    }
    default:
      return null;
  }
}

/**
 * Validate a request's raw `attribution`. Returns a deep-frozen copy, or
 * `null` when any field is missing or malformed — never a default.
 */
export function parseMcpAttribution(raw: unknown): McpAttribution | null {
  if (!isRecord(raw)) return null;
  const principal = parsePrincipal(own(raw, "principal"));
  const connectionId = own(raw, "connectionId");
  const sessionLabel = own(raw, "sessionLabel");
  const displayName = own(raw, "displayName");
  if (principal === null) return null;
  if (!isMcpConnectionId(connectionId)) return null;
  if (!isWireSessionLabel(sessionLabel) || !isWireDisplayName(displayName)) return null;
  return Object.freeze({ principal, connectionId, sessionLabel, displayName });
}
