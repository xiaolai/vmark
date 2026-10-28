/**
 * Provenance payload — the accumulator body wrapped with what it is a map
 * OF: document, editing epoch, basis, and the SHA-256 of the preimage and
 * postimage it maps between. The journal applies a payload only to its
 * declared basis, and re-checks every surviving character against the two
 * texts (`agent_journal/writer_epoch.rs`).
 *
 * Key decisions:
 *   - Hashing is `crypto.subtle` (asynchronous): no hashing dependency.
 *   - Text that is not well-formed UTF-16 is refused: the journal refuses
 *     it too, and a lone surrogate has no UTF-8 bytes to hash.
 *
 * @module services/agentJournal/provenance/payload
 */

import { MIN_PROVENANCE_CAP, PROVENANCE_CAP, type Provenance, type ProvenanceBody } from "./accumulator";
import { decodeProvenance } from "./codec";

const PROVENANCE_VERSION = 1;
const HEX64 = /^[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const U64_MAX = "18446744073709551615";
const KEYS = ["provenanceVersion", "unit", "cap", "document", "epoch", "basis", "preHash", "postHash", "body"];

export interface ProvenancePayload {
  provenanceVersion: 1;
  unit: "utf16CodeUnit";
  cap: number;
  document: string;
  epoch: string;
  basis: string;
  preHash: string;
  postHash: string;
  body: ProvenanceBody;
}

/** Lowercase hex SHA-256 of the text's UTF-8 bytes; lone surrogates are refused. */
export async function textHash(text: string): Promise<string> {
  if (!text.isWellFormed()) throw new Error("text is not well-formed UTF-16");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A canonical decimal `u64` (epochs, generations, sequence numbers): no
 * padding or sign, and at most `2^64 - 1`. Canonical digit strings of equal
 * length order as their values, so the bound is a length check and a string
 * comparison: an overlong string is refused without parsing it. Lives in the
 * provenance core (which imports nothing outside it); the journal clients
 * read it through `journalIpc.isDecimal`.
 */
export const isDecimalU64 = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length <= U64_MAX.length &&
  DECIMAL.test(v) &&
  (v.length < U64_MAX.length || v <= U64_MAX);

function checkEpoch(epoch: unknown): string {
  if (!isDecimalU64(epoch)) {
    throw new Error(`malformed epoch ${JSON.stringify(epoch)}`);
  }
  return epoch;
}

function checkId(name: string, v: unknown): string {
  if (typeof v !== "string" || v === "" || !v.isWellFormed()) throw new Error(`malformed ${name}`);
  return v;
}

export interface PayloadInput {
  document: string;
  epoch: string;
  basis: string;
  pre: string;
  post: string;
  provenance: Provenance;
}

/**
 * Wraps an accumulator; `pre`/`post` are the texts it maps between (lengths
 * are checked). The result is run through `decodePayload` before it is
 * returned: the accumulator's fields are public, so only that check proves
 * the payload is one the journal accepts (cap floor, map endpoints, size).
 */
export async function encodePayload({ document, epoch, basis, pre, post, provenance }: PayloadInput): Promise<ProvenancePayload> {
  const body = provenance.encode();
  if (body.lenA !== pre.length || body.lenB !== post.length) throw new Error("provenance lengths do not match its texts");
  const payload: ProvenancePayload = {
    provenanceVersion: PROVENANCE_VERSION,
    unit: "utf16CodeUnit",
    cap: provenance.cap,
    document: checkId("document", document),
    epoch: checkEpoch(epoch),
    basis: checkId("basis", basis),
    preHash: await textHash(pre),
    postHash: await textHash(post),
    body,
  };
  decodePayload(payload);
  return payload;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Canonical entries of an unvalidated body, counted from its array lengths alone. */
function canonicalEntries(body: unknown): number {
  if (!isRecord(body)) throw new Error("malformed provenance body");
  const { map, breaks } = body;
  const lists = [isRecord(map) ? map.runs : null, body.deletedChars, body.touchedGaps, isRecord(breaks) ? breaks.bounded : null];
  if (!lists.every(Array.isArray)) throw new Error("malformed provenance body");
  return (lists as unknown[][]).reduce((n, list) => n + list.length, 0);
}

/** Validates a payload's shape and rebuilds its accumulator. Throws on anything malformed. */
export function decodePayload(payload: unknown): Provenance {
  if (typeof payload !== "object" || payload === null) throw new Error("malformed payload");
  const p = payload as Record<string, unknown>;
  const extra = Object.keys(p).filter((k) => !KEYS.includes(k));
  if (extra.length > 0) throw new Error(`unknown payload fields ${extra.join(",")}`);
  if (p.provenanceVersion !== PROVENANCE_VERSION) throw new Error(`unsupported provenanceVersion ${String(p.provenanceVersion)}`);
  if (p.unit !== "utf16CodeUnit") throw new Error("unsupported unit");
  if (!Number.isInteger(p.cap) || (p.cap as number) < MIN_PROVENANCE_CAP || (p.cap as number) > PROVENANCE_CAP) {
    throw new Error(`malformed cap ${String(p.cap)}`);
  }
  checkId("document", p.document);
  checkEpoch(p.epoch);
  checkId("basis", p.basis);
  for (const k of ["preHash", "postHash"]) {
    if (typeof p[k] !== "string" || !HEX64.test(p[k])) throw new Error(`malformed ${k}`);
  }
  // Before rebuilding, as the journal does: a hostile body is refused on its size alone.
  if (canonicalEntries(p.body) > 2 * (p.cap as number)) throw new Error("provenance body exceeds its cap");
  return decodeProvenance(p.body, { cap: p.cap as number });
}

/** Decodes, then checks both hashes, both lengths and every surviving character. */
export async function verifyPayloadTexts(payload: unknown, pre: string, post: string): Promise<Provenance> {
  const provenance = decodePayload(payload);
  const p = payload as ProvenancePayload;
  if ((await textHash(pre)) !== p.preHash || pre.length !== p.body.lenA) throw new Error("preimage does not match");
  if ((await textHash(post)) !== p.postHash || post.length !== p.body.lenB) throw new Error("postimage does not match");
  provenance.checkTexts(pre, post);
  return provenance;
}
