/**
 * MCP session reads — the documents each MCP connection read since its last
 * write, with the coherence revision pinned at read time: the input set a
 * write consumes (`mcpCapture.ts`).
 *
 * Key decisions: see `mcpCapture.ts`, which documents the read set and its
 * bounds together with the write that consumes it. A batch is detached
 * synchronously when a write is submitted (`detachMcpReads`), so reads
 * arriving while the write is queued or saving belong to the next write;
 * a write that never happened gives its batch back (`restoreMcpReads`).
 * An MCP edit detaches its batch at admission instead (`admittedReads.ts`)
 * and hands it to its save.
 *
 * @coordinates-with mcpCapture.ts — the write that consumes a batch
 * @coordinates-with services/persistence/saveToPath.ts — detaches at submission
 * @coordinates-with services/mcpBridge/v2/admittedReads.ts — detaches at an edit's admission
 * @coordinates-with mcpConnectionLifetimes.ts — which connections may hold reads
 * @module services/coherence/mcpReads
 */
import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { workspaceRelativePath, type CoherenceCaptureInput } from "./captureFunnel";
import {
  endAllLifetimes,
  endLifetime,
  lifetimeOf,
  type ConnectionLifetime,
} from "./mcpConnectionLifetimes";

// ── MCP session-read tracking (spec §7 example 2) ───────────────
// Documents an external MCP client read since its last write become the
// (inferred) input set of that write. Module-level state, partitioned by
// connection: every client of this webview has its own set. Bounded: a
// read-only client, or connection churn, cannot grow this without limit.
// Read inputs are inferred from responses attempted for this connection;
// they prove neither receipt nor use.
const MAX_SESSION_READS = 256;
/** Connections that may hold reads: twice the bridge's concurrent cap. */
const MAX_READ_CONNECTIONS = 64;
/** Hard cap on `coherence_head` calls in flight across all paths. */
const MAX_PINS_IN_FLIGHT = MAX_SESSION_READS;
/** How long a write waits for its reads' pins; a read still unpinned then
 *  is left out of the write's inputs. */
const PIN_WAIT_MS = 500;
/** How long one `coherence_head` may hold an in-flight slot. */
const PIN_TIMEOUT_MS = 10_000;

/**
 * One read whose response was attempted for the client. An entry is
 * replaced — never reused — when the same path is read again, and is
 * detached (removed from the map) by the write that consumes it, so a pin
 * can only ever write into the read it was issued for.
 */
interface SessionRead {
  /** Workspace root at read time; the pin and `rel` are relative to it. */
  root: string;
  rel: string;
  /** Bumped by a re-read while this entry's pin is in flight. */
  generation: number;
  /** The kernel's answer for the read of `generation` it was issued for;
   *  `revision: null` means the object is known but no revision matches what
   *  was served (or its saved base). Only an answer for the CURRENT
   *  generation with a revision makes the read an input. */
  answer: { generation: number; revision: string | null } | null;
  /** The content the client was served by the latest read, if known. */
  content: string | undefined;
  /** The saved content an unsaved (dirty) served buffer was edited from. */
  baseContent: string | undefined;
  /** The in-flight `coherence_head` for this entry, if any. */
  pin: Promise<void> | null;
  /** Its pin was refused by the in-flight cap; the write asks again. */
  starved: boolean;
}

/** The reads one write consumes, detached from its connection's set. */
export interface McpReadBatch {
  readonly connectionId: string;
  /** The lifetime of the connection it was detached from. */
  readonly lifetime: ConnectionLifetime;
  /** (absolute path, read), least recent first. */
  readonly reads: ReadonlyArray<readonly [string, SessionRead]>;
}

/** connectionId → (absolute path → read), least recently reading first. */
const readsByConnection = new Map<string, Map<string, SessionRead>>();
let pinsInFlight = 0;

/** The connection's read set, made the most recent; created when absent. */
function touchConnection(connectionId: string): Map<string, SessionRead> {
  const reads = readsByConnection.get(connectionId) ?? new Map<string, SessionRead>();
  readsByConnection.delete(connectionId);
  if (readsByConnection.size >= MAX_READ_CONNECTIONS) {
    const idlest = readsByConnection.keys().next().value;
    if (idlest !== undefined) readsByConnection.delete(idlest);
  }
  readsByConnection.set(connectionId, reads);
  return reads;
}

/** Issue (at most one) revision pin for `entry`'s current generation. A pin
 *  whose answer arrives for a superseded generation is discarded and one
 *  fresh pin follows, so at most one call per entry is ever in flight.
 *  @edge-case A `coherence_head` that never settles gives its slot back after
 *  `PIN_TIMEOUT_MS`; its late answer is ignored (the read stays unpinned), so
 *  hung calls can never starve every later read of a pin. */
function startPin(entry: SessionRead): void {
  if (entry.pin) return;
  entry.starved = pinsInFlight >= MAX_PINS_IN_FLIGHT;
  if (entry.starved) return; // over cap: its write asks again, else it is left out
  pinsInFlight += 1;
  const generation = entry.generation;
  let released = false;
  let release: () => void = () => {};
  const timedOut = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, PIN_TIMEOUT_MS);
    release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      resolve();
    };
  });
  const call = invoke<{ object: string; revision: string | null } | null>("coherence_head", {
    workspaceRoot: entry.root,
    path: entry.rel,
    content: entry.content,
    baseContent: entry.baseContent,
  })
    .then((head) => {
      if (released || !head || entry.generation !== generation) return;
      entry.answer = { generation, revision: head.revision };
    })
    // A refused pin leaves the read unpinned, and so out of its write's inputs.
    .catch(() => {});
  const pin = Promise.race([call.finally(release), timedOut]).then(() => {
    release();
    pinsInFlight -= 1;
    if (entry.pin === pin) entry.pin = null;
    if (entry.generation !== generation) startPin(entry);
  });
  entry.pin = pin;
}

/** The saved content an unsaved buffer served from `tabId` was edited
 *  from, or undefined when the served content is the saved content. */
function savedBase(tabId: string | undefined, content: string | undefined): string | undefined {
  const saved = tabId ? useDocumentStore.getState().documents[tabId]?.savedContent : undefined;
  return saved !== undefined && saved !== content ? saved : undefined;
}

/** The entry for a fresh read: `existing` superseded in place when it was
 *  read under the same root (so its in-flight pin coalesces), else a new one. */
function nextRead(
  existing: SessionRead | undefined,
  root: string,
  rel: string,
  content: string | undefined,
  baseContent: string | undefined,
): SessionRead {
  if (existing && existing.root === root) {
    existing.generation += 1;
    existing.answer = null;
    existing.content = content;
    existing.baseContent = baseContent;
    return existing;
  }
  return { root, rel, generation: 0, answer: null, content, baseContent, pin: null, starved: false };
}

/** The connection's lifetime as a request begins: a read handler takes it
 *  before anything else and hands it to `recordMcpRead`, so a close or a
 *  bridge stop landing anywhere in between refuses the read. */
export function mcpRequestLifetime(connectionId: string): ConnectionLifetime {
  return lifetimeOf(connectionId);
}

/** Record a document read served to MCP connection `connectionId`
 *  (absolute path). Pins the coherence revision served at READ time so a
 *  later upstream edit is never misattributed as this write's input.
 *  `content` is what was served and `tabId` the tab it came from, whose saved
 *  content is the base of an unsaved buffer; the caller records in the same
 *  task it took `content` in, so the root and base sampled here are the ones
 *  that content was served with. `lifetime` is the connection's lifetime when
 *  the request began (`mcpRequestLifetime`); ended since, the read is refused.
 *  A read made outside the open workspace is not recorded — it could never be
 *  an input. */
export function recordMcpRead(
  connectionId: string,
  absolutePath: string,
  content?: string,
  tabId?: string,
  lifetime: ConnectionLifetime = lifetimeOf(connectionId),
): void {
  if (lifetime.closed) return; // the request outlived its connection or bridge
  const root = useWorkspaceStore.getState().rootPath;
  const rel = root ? workspaceRelativePath(root, absolutePath) : null;
  const existing = readsByConnection.get(connectionId)?.get(absolutePath);
  readsByConnection.get(connectionId)?.delete(absolutePath); // a re-read counts as the most recent
  if (!root || !rel) return;
  const reads = touchConnection(connectionId);
  if (reads.size >= MAX_SESSION_READS) {
    const oldest = reads.keys().next().value;
    if (oldest !== undefined) reads.delete(oldest);
  }
  const entry = nextRead(existing, root, rel, content, savedBase(tabId, content));
  reads.set(absolutePath, entry);
  startPin(entry);
}

/** Detach every read the connection recorded at once: reads arriving later
 *  belong to its NEXT write, and two concurrent writes can never consume the
 *  same read. The emptied partition is removed. */
function detachReads(connectionId: string): McpReadBatch {
  const reads = readsByConnection.get(connectionId);
  readsByConnection.delete(connectionId);
  return { connectionId, lifetime: lifetimeOf(connectionId), reads: reads ? [...reads] : [] };
}

/** Detach the connection's reads for the write being submitted now, and ask
 *  again for any pin the in-flight cap refused at read time. */
export function detachMcpReads(connectionId: string): McpReadBatch {
  const batch = detachReads(connectionId);
  for (const [, entry] of batch.reads) if (entry.starved) startPin(entry);
  return batch;
}

/** Give back a batch whose write never happened: its reads precede the
 *  connection's next write. A path read again since keeps the newer read;
 *  the returned reads count as the oldest, within the per-connection bound.
 *  @edge-case A batch whose connection closed, or whose bridge stopped,
 *  while its write was in flight is discarded: there is no next write. */
export function restoreMcpReads(batch: McpReadBatch): void {
  if (batch.reads.length === 0) return;
  if (batch.lifetime.closed) return;
  const current = readsByConnection.get(batch.connectionId) ?? new Map<string, SessionRead>();
  const kept = batch.reads.filter(([path]) => !current.has(path));
  const merged = [...kept, ...current].slice(-MAX_SESSION_READS);
  const reads = touchConnection(batch.connectionId);
  reads.clear();
  for (const [path, entry] of merged) reads.set(path, entry);
}

/** Drop a closed connection's reads, and refuse any it would gain later
 *  (a late read, a failed save's batch). Unknown ids are a no-op for the
 *  reads. A pin still in flight for a dropped read writes only into the
 *  detached entry. */
export function dropMcpConnectionReads(connectionId: string): void {
  readsByConnection.delete(connectionId);
  endLifetime(connectionId);
}

/** Drop every connection's reads (the bridge stopped): every lifetime seen
 *  so far ends, so batches detached before now can no longer be given back. */
export function dropAllMcpConnectionReads(): void {
  readsByConnection.clear();
  endAllLifetimes();
}

/** Wait (bounded) for this batch's pins — including a re-pin a superseded
 *  answer triggered. */
export async function awaitBatchPins(batch: McpReadBatch): Promise<void> {
  const deadline = Date.now() + PIN_WAIT_MS;
  for (;;) {
    const pins = batch.reads.flatMap(([, e]) => (e.pin ? [e.pin] : []));
    const remaining = deadline - Date.now();
    if (pins.length === 0 || remaining <= 0) return;
    await Promise.race([
      Promise.allSettled(pins),
      new Promise((resolve) => setTimeout(resolve, remaining)),
    ]);
  }
}

/** The revision pinned for the entry's current read, or undefined while
 *  none is (in flight, refused, unanswered, superseded, or unprovable). */
function pinnedRevision(e: SessionRead): string | undefined {
  return e.answer?.generation === e.generation ? (e.answer.revision ?? undefined) : undefined;
}

/** The batch's reads made under `root` whose current read has a pinned
 *  revision, as capture inputs. An unpinned read is LEFT OUT: the kernel
 *  resolves an input without a revision to the head at write time, which the
 *  client may never have seen. A read served under another workspace root
 *  carries a revision of ANOTHER ledger, so it is dropped rather than
 *  re-rooted. */
export function toInputs(batch: McpReadBatch, root: string): CoherenceCaptureInput[] {
  return batch.reads.flatMap(([, e]) => {
    const revision = e.root === root ? pinnedRevision(e) : undefined;
    return revision === undefined ? [] : [{ path: e.rel, revision, role: "direct" as const }];
  });
}
