// @vitest-environment node
// WI-AL2.2a — a provenance session sends its captures in seq order: a freeze's send waits until every earlier freeze of the session has replied or settled, a send settling (success or failure) ends its turn, and so does its holder settling the freeze mid-send (abandoned at its deadline), so a send that never settles holds later freezes only that long — disposing the session neither releases nor strands a waiting send — the over-budget freeze takes its turn like any other, a freeze sends at most once; and against a journal that refuses a seq not extending its session's last, a save frozen before a prepare and two prepares frozen together are never refused for arriving out of order, and an abandoned send landing late is refused, failing closed
import { describe, it, expect, vi } from "vitest";
import { ProvenanceSession, type ProvenanceFreeze, type SessionJournal } from "../provenance/session";

const journal = (): SessionJournal => ({
  arm: () => Promise.reject(new Error("not armed in this test")),
  close: async () => {},
});

const session = (maxFrozen?: number) =>
  new ProvenanceSession("text", journal(), { warn: vi.fn(), view: "main/t-1", ...(maxFrozen === undefined ? {} : { maxFrozen }) });

/** A promise and its resolver. */
function gate<T = void>() {
  let open!: (value: T) => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { promise, open, fail };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The writer's check (`capture_seq.rs`): a seq must extend the session's last recorded one; recorded on success only. */
function seqJournal() {
  const last = new Map<string, bigint>();
  const refused: string[] = [];
  const recorded: string[] = [];
  return {
    refused,
    recorded,
    async send(freeze: ProvenanceFreeze, delay: Promise<void>): Promise<void> {
      await delay;
      const { session: id, seq } = freeze.capture;
      if (BigInt(seq) <= (last.get(id) ?? 0n)) {
        refused.push(seq);
        throw new Error(`INVALID_REQUEST: capture seq ${seq} does not extend the session's last`);
      }
      last.set(id, BigInt(seq));
      recorded.push(seq);
    },
  };
}

describe("capture turns", () => {
  it("holds a later freeze's send until the earlier freeze's send settles", async () => {
    const s = session();
    const [a, b] = [s.freeze("text"), s.freeze("text")];
    const sendB = vi.fn(async () => "b");
    const outB = b.inTurn(sendB);
    await flush();
    expect(sendB).not.toHaveBeenCalled();
    const replyA = gate<string>();
    const outA = a.inTurn(() => replyA.promise);
    await flush();
    expect(sendB).not.toHaveBeenCalled();
    replyA.open("a");
    expect(await outA).toBe("a");
    expect(await outB).toBe("b");
  });

  it("releases the turn of a freeze settled without sending", async () => {
    const s = session();
    const [a, b, c] = [s.freeze("text"), s.freeze("text"), s.freeze("text")];
    a.invalidate();
    b.recorded("rev-1");
    expect(await c.inTurn(async () => "c")).toBe("c");
  });

  it("holds a later freeze behind a send that never settles only until its holder settles it (its deadline passed)", async () => {
    const s = session();
    const [a, b] = [s.freeze("text"), s.freeze("text")];
    void a.inTurn(() => new Promise<void>(() => {})); // never answered
    const sendB = vi.fn(async () => "b");
    const outB = b.inTurn(sendB);
    await flush();
    expect(sendB).not.toHaveBeenCalled();
    a.invalidate(); // what every caller does at its deadline
    await flush();
    expect(sendB).toHaveBeenCalledOnce();
    expect(await outB).toBe("b");
  });

  it("keeps a waiting send in order after the session is disposed, and sends it once the earlier holder settles", async () => {
    const s = session();
    const [a, b] = [s.freeze("text"), s.freeze("text")];
    void a.inTurn(() => new Promise<void>(() => {})); // never answered
    const sendB = vi.fn(async () => "b");
    const outB = b.inTurn(sendB);
    await s.dispose();
    await flush();
    expect(sendB).not.toHaveBeenCalled();
    a.invalidate();
    await flush();
    expect(sendB).toHaveBeenCalledOnce();
    expect(await outB).toBe("b");
  });

  it("ends the turn when the send fails, and passes the failure on", async () => {
    const s = session();
    const [a, b] = [s.freeze("text"), s.freeze("text")];
    await expect(a.inTurn(() => Promise.reject(new Error("refused")))).rejects.toThrow("refused");
    expect(await b.inTurn(async () => "b")).toBe("b");
  });

  it("waits for every earlier freeze, not only the one before it", async () => {
    const s = session();
    const [a, b, c] = [s.freeze("text"), s.freeze("text"), s.freeze("text")];
    const replyA = gate();
    void a.inTurn(() => replyA.promise);
    b.invalidate();
    const sendC = vi.fn(async () => {});
    const outC = c.inTurn(sendC);
    await flush();
    expect(sendC).not.toHaveBeenCalled();
    replyA.open();
    await outC;
    expect(sendC).toHaveBeenCalledOnce();
  });

  it("gives the over-budget freeze a turn like any other", async () => {
    const s = session(1);
    const [a, over, c] = [s.freeze("text"), s.freeze("text"), s.freeze("text")];
    a.invalidate();
    const replyOver = gate();
    void over.inTurn(() => replyOver.promise);
    const sendC = vi.fn(async () => {});
    const outC = c.inTurn(sendC);
    await flush();
    expect(sendC).not.toHaveBeenCalled();
    replyOver.open();
    await outC;
    over.invalidate();
    const d = s.freeze("text");
    expect(await d.inTurn(async () => "d")).toBe("d");
  });

  it("refuses a second send, or a send after the freeze settled", async () => {
    const s = session();
    const [a, b] = [s.freeze("text"), s.freeze("text")];
    await a.inTurn(async () => {});
    await expect(a.inTurn(async () => {})).rejects.toThrow(/once/);
    b.invalidate();
    await expect(b.inTurn(async () => {})).rejects.toThrow(/once/);
  });
});

describe("capture turns against the journal's seq check", () => {
  it("never refuses a save frozen before a prepare whose send is issued first", async () => {
    const s = session();
    const j = seqJournal();
    const save = s.freeze("text"); // frozen at submission; sent after the disk write
    const prepare = s.freeze("text");
    const disk = gate();
    const sentPrepare = prepare.inTurn(() => j.send(prepare, Promise.resolve()));
    const sentSave = disk.promise.then(() => save.inTurn(() => j.send(save, Promise.resolve())));
    await flush();
    disk.open();
    await Promise.all([sentSave, sentPrepare]);
    expect(j.refused).toEqual([]);
  });

  it("fails closed when an abandoned send lands after the freeze released behind it: the late one is refused, the later one recorded", async () => {
    const s = session();
    const j = seqJournal();
    const [a, b] = [s.freeze("text"), s.freeze("text")];
    const slowA = gate();
    const sentA = a.inTurn(() => j.send(a, slowA.promise)).catch((error: unknown) => error);
    a.invalidate(); // its holder's deadline passed while it was in flight
    const sentB = b.inTurn(() => j.send(b, Promise.resolve()));
    await flush();
    expect(j.recorded).toEqual([b.capture.seq]);
    await sentB;
    slowA.open();
    expect(await sentA).toBeInstanceOf(Error);
    expect(j.refused).toEqual([a.capture.seq]);
  });

  it("never refuses either of two prepares frozen together, whichever reaches IPC first", async () => {
    const s = session();
    const j = seqJournal();
    const [a, b] = [s.freeze("text"), s.freeze("text")];
    const slowA = gate();
    const sentB = b.inTurn(() => j.send(b, Promise.resolve()));
    const sentA = a.inTurn(() => j.send(a, slowA.promise));
    await flush();
    slowA.open();
    await Promise.all([sentA, sentB]);
    expect(j.refused).toEqual([]);
  });
});
