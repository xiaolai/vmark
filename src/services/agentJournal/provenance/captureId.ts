/**
 * Capture ids — the identity a provenance session gives each freeze,
 * `{view, session, seq}`, which a save and a controlled prepare send so the
 * journal refuses a capture whose seq does not extend its session's last
 * one — and the turn that sends each in seq order.
 *
 * Key decisions:
 *   - `session` is a random UUID minted once per session object, so no id
 *     is reused across sessions, reloads or runs (the journal keeps the
 *     last seq per session in memory only and refuses a seq that restarts).
 *   - `seq` counts freezes from 1 as a canonical decimal string, so it
 *     never loses precision; every freeze takes the next one, refused or not.
 *   - `view` and `session` must be 1 to 128 UTF-8 bytes on the wire; a view
 *     is fitted on whole code points, and an empty one is named `view`.
 *   - Captures are sent in seq order, so a legitimate reordering (a save
 *     frozen at submission but sent after its disk write, two agent writes
 *     frozen together) never reaches the journal's check out of order: a
 *     freeze's send waits until every earlier freeze has replied or settled
 *     unsent. The turn ends when the send settles, or when its holder
 *     settles the freeze first: every caller does at its deadline, so a send
 *     that never settles holds the freezes behind it only that long. If the
 *     abandoned send lands after a later one, the journal refuses its seq,
 *     which fails closed. A caller re-checks its deadline inside the turn.
 *     Disposing the session releases nothing: a waiting send stays in order.
 *
 * @coordinates-with services/agentJournal/provenance/session.ts — mints one per freeze
 * @coordinates-with src-tauri/src/agent_journal/capture_seq.rs — the journal's check
 * @module services/agentJournal/provenance/captureId
 */

/** The journal's limit on a capture `view` or `session`, in UTF-8 bytes. */
export const CAPTURE_PART_MAX_BYTES = 128;

/** A freeze's identity, as the journal's wire carries it. */
export interface CaptureId {
  view: string;
  session: string;
  /** Canonical decimal `u64`. */
  seq: string;
}

/** The longest prefix of `text` (whole code points) within the byte limit. */
function fitView(text: string): string {
  const encoder = new TextEncoder();
  let bytes = 0;
  let out = "";
  for (const ch of text) {
    bytes += encoder.encode(ch).length;
    if (bytes > CAPTURE_PART_MAX_BYTES) break;
    out += ch;
  }
  return out === "" ? "view" : out;
}

/** One freeze's place in its session's send order. */
export interface CaptureTurn {
  /** Run `send` once every earlier freeze's turn ended; this turn ends when `send` settles or `settle` is called. Once, before `settle`. */
  run<T>(send: () => Promise<T>): Promise<T>;
  /** The freeze settled (answered or abandoned): ends the turn, even while a send runs. Idempotent. */
  settle(): void;
}

/** A minter for one session's capture ids under `view`: seq 1, 2, … on each call, each with its turn. */
export function captureMinter(view: string): () => { id: CaptureId; turn: CaptureTurn } {
  const fitted = fitView(view);
  const session = crypto.randomUUID();
  let seq = 0n;
  let last: Promise<void> = Promise.resolve();
  return () => {
    seq += 1n;
    const before = last;
    let endOwn: () => void = () => {};
    const own = new Promise<void>((resolve) => (endOwn = resolve));
    last = Promise.all([before, own]).then(() => {});
    let state: "open" | "sending" | "ended" = "open";
    const end = () => {
      state = "ended";
      endOwn();
    };
    const turn: CaptureTurn = {
      async run(send) {
        if (state !== "open") throw new Error("a capture is sent once, before its freeze settles");
        state = "sending";
        try {
          await before;
          return await send();
        } finally {
          end();
        }
      },
      settle: end,
    };
    return { id: { view: fitted, session, seq: seq.toString() }, turn };
  };
}
