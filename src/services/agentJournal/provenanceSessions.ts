/**
 * Provenance sessions — the production provenance sources: one
 * `ProvenanceSession` per open tab and document, registered as the tab's
 * unsaved-provenance source, kept in step with the document store.
 *
 * Pipeline: the store gains a tab → a session on its text, registered with
 * `unsavedProvenance.ts` → the tab's editors attach collectors
 * (`provenanceSessionFor`) and report each edit before they write the store
 * → every store write is checked against what the session was told.
 *
 * Key decisions:
 *   - Fail closed on what no collector announced: a content change the
 *     session did not already hold breaks the whole window
 *     (`store:unobserved-write`); a new `documentId` (reload, external
 *     ingest) breaks it even at equal text.
 *   - The session is per tab AND document key: a save-as or rename moves
 *     the tab to a new key, so its session is disposed and a new one opened
 *     on the current text. The tab's journal document goes with it
 *     (`bindJournalDocument`, ADR-AL7) and, once that lands, its basis
 *     too; a failed bind keeps the basis on the old key and the new session
 *     never arms (snapshot-only) until a bind there lands. The new session
 *     arms only once the bind has landed and the old session's epoch has
 *     closed (the writer refuses a second open epoch on one document), and
 *     an epoch is closed on the document it was armed on, whatever its key
 *     names by then. A session closed before its arm started never arms. Collectors
 *     find the replacement through `provenanceSessionFor` and re-attach
 *     uncertified.
 *   - Budget: one session per open tab, nothing else retained here; a
 *     closed tab's session is disposed (its epoch closed) and its source
 *     unregistered in the same store update.
 *   - The subscription keeps the previous documents map itself (the
 *     store's plain `subscribe`), so a cursor or selection update costs a
 *     reference compare per tab.
 *
 * @coordinates-with services/agentJournal/provenance/session.ts — the session
 * @coordinates-with services/agentJournal/unsavedProvenance.ts — the registration
 * @coordinates-with services/runtimeWiring.ts — starts this with the window
 * @module services/agentJournal/provenanceSessions
 */

import { useDocumentStore } from "@/stores/documentStore";
import type { DocumentState } from "@/stores/documentStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { journalWarn } from "@/utils/debug";
import { armEpoch, closeEpoch } from "./epochClient";
import { bindJournalDocument, isJournalDocumentUnbound, journalDocumentReady, noteJournalDocument } from "./documentBinding";
import { carryJournalBasis, docKeyFor, isJournalTabLive, journalKeyNow, journalTabLife } from "./documentIdentity";
import { ProvenanceSession } from "./provenance/session";
import type { SessionJournal } from "./provenance/epochLease";
import { registerUnsavedProvenanceSource } from "./unsavedProvenance";

interface Entry {
  session: ProvenanceSession;
  /** Set when the session is closed; an arm still waiting then never starts. */
  closed: { value: boolean };
  docKey: string;
  documentId: number;
  unregister: () => void;
}

const entries = new Map<string, Entry>();

/** The tab's live session, or `null` when the service is stopped or the tab has none. */
export function provenanceSessionFor(tabId: string): ProvenanceSession | null {
  return entries.get(tabId)?.session ?? null;
}

/**
 * The session's journal for `docKey`: arm and close run on one serialized
 * chain, so the last arm names the document every close is for. The writer
 * allows one open epoch per document and a bind carries the document to the
 * new key, so the first arm also waits for `previous`, the old session's
 * close. An arm still waiting when `closed` is set never starts.
 */
function epochJournal(docKey: string, previous: Promise<void>, closed: { readonly value: boolean }): SessionJournal {
  let armedOn: string | undefined;
  const arm = async () => {
    await previous;
    const ready = await journalDocumentReady(docKey);
    // @edge-case Moved on again (A to B, then B to C) while waiting: arming
    // B now would mint an orphan document for a key the tab left.
    if (closed.value) throw new Error(`the session for ${docKey} closed before it armed`);
    // @edge-case The bind to this key failed: the journal still holds the
    // document under the old key, and an arm here would mint a second one.
    // Snapshot-only until a bind lands; the first demand after that retries.
    if (!ready.ok) throw ready.refusal;
    const armed = await armEpoch(docKey);
    armedOn = armed.doc;
    noteJournalDocument(docKey, armed.doc);
    return armed;
  };
  return { arm, close: (epoch) => closeEpoch(docKey, epoch, armedOn), suspended: () => isJournalDocumentUnbound(docKey) };
}

/** Register `session` as the tab's unsaved-provenance source; returns the unregister. */
function registerSession(tabId: string, session: ProvenanceSession): () => void {
  return registerUnsavedProvenanceSource(tabId, {
    freeze: (buffer) => session.freeze(buffer),
    fork: (text) => session.fork(text),
  });
}

function open(tabId: string, doc: DocumentState, docKey: string, previous: Promise<void> = Promise.resolve()): void {
  const closed = { value: false };
  const session = new ProvenanceSession(doc.content, epochJournal(docKey, previous, closed), {
    view: `${getCurrentWindowLabel()}/${tabId}`,
    warn: journalWarn,
  });
  entries.set(tabId, { session, closed, docKey, documentId: doc.documentId, unregister: registerSession(tabId, session) });
}

/** Dispose the tab's session; resolves (never rejects) once its epoch is closed. */
function close(tabId: string): Promise<void> {
  const entry = entries.get(tabId);
  if (!entry) return Promise.resolve();
  entries.delete(tabId);
  entry.closed.value = true;
  entry.unregister();
  return entry.session.dispose().catch((error: unknown) => journalWarn("provenance: could not close an editing epoch", error));
}

/**
 * Bind the tab's journal document `from → to`; its basis follows only once
 * the bind landed. A failed bind leaves the basis on `from`, the key the
 * journal still holds the document under, for the save that retries it.
 */
function carryOnBind(tabId: string, from: string, to: string): void {
  const life = journalTabLife(tabId);
  void bindJournalDocument(from, to).then((bound) => {
    if (bound.ok && isJournalTabLive(tabId, life) && journalKeyNow(tabId, from) === from) carryJournalBasis(tabId, from, to);
  });
}

function sync(tabId: string, doc: DocumentState, windowLabel: string): void {
  const docKey = docKeyFor({ tabId, filePath: doc.filePath }, windowLabel);
  const entry = entries.get(tabId);
  if (!entry || entry.docKey !== docKey) {
    const closed = close(tabId);
    if (entry) carryOnBind(tabId, entry.docKey, docKey);
    return open(tabId, doc, docKey, closed);
  }
  if (entry.documentId !== doc.documentId) {
    entry.documentId = doc.documentId;
    entry.session.observeReload(doc.content);
  } else {
    entry.session.observeStoreText(doc.content);
  }
}

/** Keep a session for every open tab until the returned disposer runs. */
export function startProvenanceSessions(): () => void {
  const windowLabel = getCurrentWindowLabel();
  let previous: Record<string, DocumentState> = {};
  const apply = (documents: Record<string, DocumentState>) => {
    for (const tabId of Object.keys(previous)) if (!(tabId in documents)) void close(tabId);
    for (const [tabId, doc] of Object.entries(documents)) {
      if (previous[tabId] === doc) continue;
      sync(tabId, doc, windowLabel);
    }
    previous = documents;
  };
  apply(useDocumentStore.getState().documents);
  const unsubscribe = useDocumentStore.subscribe((state) => {
    if (state.documents !== previous) apply(state.documents);
  });
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    for (const tabId of [...entries.keys()]) void close(tabId);
  };
}
