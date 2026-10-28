/**
 * Epoch client — the IPC calls a window's provenance session makes besides
 * prepare and capture: arm and close a document's editing epoch, release
 * a closed tab's base root, bind or look up a key's document, and read its
 * head (the parent a controlled write expects). Replies are validated and every
 * rejection is read as a `JournalRefusal` (`journalIpc.ts`).
 *
 * Key decisions:
 *   - Epochs are canonical decimal strings (a u64 does not fit a number).
 *   - The arm reply's `head` and `headHash` come together or not at all: a
 *     window trusts the head as its first map's basis only after its own
 *     text hashes the same.
 *
 * @coordinates-with src-tauri/src/agent_journal/controller.rs — arm_epoch, close_epoch, release_window
 * @coordinates-with src-tauri/src/agent_journal/service_identity.rs — bind_document, find_document, head
 * @module services/agentJournal/epochClient
 */

import { callJournalBound as call, isDecimal, isObject, isString as isId, malformed } from "./journalIpc";

export interface ArmedEpoch {
  /** The journal's document id: a payload's `document`. */
  doc: string;
  /** Decimal string. */
  epoch: string;
  /** The settled head when armed, and `sha256-<hex>` of its text; both or neither. */
  head: string | null;
  headHash: string | null;
}

const ARM = "agent_journal_arm_epoch";
const BLOB_HASH = /^sha256-[0-9a-f]{64}$/;

/** Arm the next editing epoch of `docKey`. Rejects with a `JournalRefusal`. */
export async function armEpoch(docKey: string): Promise<ArmedEpoch> {
  const r = await call(ARM, { payload: JSON.stringify({ docKey }) });
  if (!isObject(r) || !isId(r.doc) || !isDecimal(r.epoch)) throw malformed(ARM);
  const { doc, epoch, head, headHash } = r;
  if (head === null && headHash === null) return { doc, epoch, head: null, headHash: null };
  if (isId(head) && typeof headHash === "string" && BLOB_HASH.test(headHash)) return { doc, epoch, head, headHash };
  throw malformed(ARM);
}

/**
 * Close `epoch` of `docKey` (a compare-and-set). `doc` is the document the
 * arm reply named, so a close after a rename or Save As still finds it.
 * Rejects with a `JournalRefusal`.
 */
export async function closeEpoch(docKey: string, epoch: string, doc?: string): Promise<void> {
  const payload = doc === undefined ? { docKey, epoch } : { docKey, epoch, doc };
  await call("agent_journal_close_epoch", { payload: JSON.stringify(payload) });
}

const BIND = "agent_journal_bind_document";

/**
 * Carry `from`'s journal document to the key `to` (Save As, rename).
 * `expectedDoc` is a compare-and-set on the source: omitted, nothing is
 * checked; `null`, `from` must carry no document; an id, `from` must still
 * carry that one. A replayed bind whose source was reused, or whose
 * destination was rebound since, is refused. Resolves with the document
 * `to` carries now (minted when `from` carried none). Rejects with a
 * `JournalRefusal`.
 */
export async function bindDocument(from: string, to: string, expectedDoc?: string | null): Promise<string> {
  const payload = expectedDoc === undefined ? { from, to } : { from, to, expectedDoc };
  const r = await call(BIND, { payload: JSON.stringify(payload) });
  if (!isId(r)) throw malformed(BIND);
  return r;
}

const FIND = "agent_journal_find_document";

/**
 * The journal document `docKey` carries, or `null` when it has none. A
 * read: unlike arming an epoch, it never mints a document. Rejects with a
 * `JournalRefusal`.
 */
export async function findDocument(docKey: string): Promise<string | null> {
  const r = await call(FIND, { payload: JSON.stringify({ docKey }) });
  if (r === null || isId(r)) return r;
  throw malformed(FIND);
}

const HEAD = "agent_journal_head";

/**
 * The head revision of `docKey`, or `null` at genesis (no revision, or no
 * document). A read: it never mints a document. Rejects with a
 * `JournalRefusal`.
 */
export async function readJournalHead(docKey: string): Promise<string | null> {
  const r = await call(HEAD, { payload: JSON.stringify({ docKey }) });
  if (r === null || isId(r)) return r;
  throw malformed(HEAD);
}

/** A tab closed: release its base root. Idempotent. Rejects with a `JournalRefusal`. */
export async function releaseWindow(window: string): Promise<void> {
  await call("agent_journal_release_window", { window });
}
