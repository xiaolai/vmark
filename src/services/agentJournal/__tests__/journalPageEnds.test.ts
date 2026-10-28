// WI-AL2.2g — how a journaled write ends when its page registration does, through the real transport, IPC validation, page registration, request coordinator and controlled write: a STALE_PAGE commit is applied, not durable, never retried, and renews the registration (fresh identity, replaces = the old pair); a STALE_PAGE abort ends the request and renews it the same way; byte-identical staleGeneration answers for a sealed and for a revoked generation recover identically (drain, fresh identity with replaces, proceed); a pagehide while committing leaves the commit and its outcome unchanged, and one while applying still commits on the prepare's pair; a hanging register ends JOURNAL_TIMEOUT with zero prepares, no late dispatch and no timer left; a registration that fails before any dispatch releases the freeze
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.unmock("@/services/agentJournal/journalTransport");

import { resetPageRegistration } from "../pageRegistration";
import { registerUnsavedProvenanceSource } from "../unsavedProvenance";
import { runJournaledMutation } from "../journaledMutation";
import type { NamedPayload } from "../provenance/session";
import { TAB, content, mutation, resetMutationFixture } from "./journaledMutationFixture";
import { boundPair, boundPrepare, preparedReply, requestAnswer, scriptWire } from "./journalWire";

const PREPARE = "agent_journal_prepare";
const COMMIT = "agent_journal_commit";
const ABORT = "agent_journal_abort";
const ABANDON = "agent_journal_abandon";
const REGISTER = "agent_journal_register_page";

type Wire = ReturnType<typeof scriptWire>;
let wire: Wire;

const committed = { doc: "path:/a.md", revision: "rev-1", applied: true, durable: true, certified: false, fallbackReason: null };
const stalePage = () => Promise.reject({ code: "conflict", message: "STALE_PAGE: the page is no longer registered", detail: { journalCode: "STALE_PAGE" } });

function source() {
  const freeze = {
    touched: true,
    capture: { view: "v", session: "s", seq: "1" },
    inTurn: <T,>(send: () => Promise<T>) => send(),
    payload: vi.fn(async (): Promise<NamedPayload | null> => null),
    recorded: vi.fn(),
    invalidate: vi.fn(),
    release: vi.fn(),
  };
  registerUnsavedProvenanceSource(TAB, { freeze: () => freeze, fork: () => ({ recorded: () => {}, invalidate: () => {} }) });
  return freeze;
}

const prepared = () => wire.on(PREPARE, (a) => boundPrepare(String(a.payload), preparedReply()));
const registers = () => wire.argsOf(REGISTER);
const pairOf = (args: Record<string, unknown>) => ({ pageIdentity: args.pageIdentity, webviewGeneration: args.webviewGeneration });

function pagehide(persisted: boolean): void {
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted }));
}

/** The next write registers a fresh identity naming `old` in `replaces`, then applies. */
async function expectRenewedFrom(old: Record<string, unknown>): Promise<void> {
  wire.on(COMMIT, (args) => boundPair(args, committed));
  prepared();
  const before = registers().length;
  expect(await runJournaledMutation(mutation())).toMatchObject({ status: "applied", durable: true });
  expect(registers()).toHaveLength(before + 1);
  const fresh = registers().at(-1);
  expect(fresh?.pageIdentity).not.toBe(old.pageIdentity);
  expect(fresh?.replaces).toEqual({ pageIdentity: old.pageIdentity, webviewGeneration: old.webviewGeneration });
}

beforeEach(() => {
  resetMutationFixture();
  resetPageRegistration();
  wire = scriptWire();
  wire.on(ABORT, (args) => boundPair(args, { durable: true }));
  wire.on(ABANDON, () => ({ state: "fenced" }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a page registration that ended under a write", () => {
  it("a stale-page commit reports durable false and never retries", async () => {
    prepared();
    wire.on(COMMIT, stalePage);
    expect(await runJournaledMutation(mutation())).toMatchObject({ status: "applied", durable: false });
    expect(content()).toBe("after");
    expect(wire.argsOf(COMMIT)).toHaveLength(1);
    expect(wire.argsOf(ABORT)).toEqual([]);
    expect(wire.argsOf(ABANDON)).toEqual([]);
    const commitPair = pairOf(wire.argsOf(COMMIT)[0]);
    await expectRenewedFrom(commitPair);
  });

  it("a stale-page abort ends the request and renews the registration", async () => {
    prepared();
    wire.on(ABORT, stalePage);
    expect(await runJournaledMutation(mutation({ verify: () => "edited" }))).toMatchObject({ status: "aborted", reason: "edited" });
    expect(content()).toBe("before");
    expect(wire.argsOf(ABORT)).toHaveLength(1);
    expect(wire.argsOf(COMMIT)).toEqual([]);
    await expectRenewedFrom(pairOf(wire.argsOf(ABORT)[0]));
  });

  it("sealed_and_revoked_stale_answers_recover_identically", async () => {
    // The client cannot tell a sealed generation from a revoked one: both answer the same bytes.
    // A small model of the label's registration table checks that neither recovery consumes a slot.
    async function recover(cause: "sealed" | "revoked") {
      resetMutationFixture();
      resetPageRegistration();
      wire = scriptWire();
      const table = new Map<string, string>();
      let generation = 0;
      wire.on(REGISTER, (args) => {
        const replaces = args.replaces;
        if (typeof replaces === "object" && replaces !== null && "webviewGeneration" in replaces) table.delete(String(replaces.webviewGeneration));
        generation += 1;
        table.set(String(generation), String(args.pageIdentity));
        return { bind: { pageIdentity: args.pageIdentity }, reply: { incarnation: "0123456789abcdef0123456789abcdef", webviewGeneration: String(generation), pageIdentity: args.pageIdentity } };
      });
      wire.on(ABANDON, () => ({ state: "fenced" }));
      const staleAnswer = { state: "staleGeneration" };
      let release: () => void = () => {};
      let holderPrepared = false;
      let n = 0;
      wire.on(PREPARE, async (a) => {
        n += 1;
        if (n === 1) {
          holderPrepared = true;
          return boundPrepare(String(a.payload), preparedReply(1));
        }
        if (cause === "revoked") table.delete(String(JSON.parse(String(a.payload)).webviewGeneration));
        return requestAnswer(String(a.payload), "STALE_REQUEST", true, staleAnswer).then((e) => Promise.reject(e));
      });
      // A first write holds the pair: it is committing when the stale answer arrives.
      wire.on(COMMIT, (args) => new Promise((r) => (release = () => r(boundPair(args, committed)))));
      const holder = runJournaledMutation(mutation());
      await vi.waitFor(() => expect(holderPrepared && wire.argsOf(COMMIT).length === 1).toBe(true));
      const stale = await runJournaledMutation(mutation({ preimage: "after" }));
      const afterStale = registers().length;
      wire.on(PREPARE, (a) => boundPrepare(String(a.payload), preparedReply()));
      wire.on(COMMIT, (args) => boundPair(args, committed));
      const next = runJournaledMutation(mutation({ preimage: "after" }));
      for (let i = 0; i < 50; i += 1) await new Promise((r) => setImmediate(r));
      const registeredBeforeDrain = registers().length;
      release();
      const held = await holder;
      const proceeded = await next;
      const [first, renewed] = registers();
      return { stale, held, proceeded, afterStale, registeredBeforeDrain, first, renewed, slots: table.size, count: registers().length };
    }
    const sealed = await recover("sealed");
    const revoked = await recover("revoked");
    for (const r of [sealed, revoked]) {
      expect(r.stale).toMatchObject({ status: "refused", refusal: { uncertain: true } });
      expect(r.afterStale).toBe(1);
      expect(r.registeredBeforeDrain).toBe(1);
      expect(r.held).toMatchObject({ status: "applied", durable: true });
      expect(r.proceeded).toMatchObject({ status: "applied", durable: true });
      expect(r.count).toBe(2);
      expect(r.renewed.pageIdentity).not.toBe(r.first.pageIdentity);
      expect(r.renewed.replaces).toEqual({ pageIdentity: r.first.pageIdentity, webviewGeneration: "1" });
      expect(r.slots).toBe(1);
    }
    expect(Object.keys(revoked.renewed).sort()).toEqual(Object.keys(sealed.renewed).sort());
  });

  it("pagehide during committing → the commit continues, outcome unchanged", async () => {
    prepared();
    let release: () => void = () => {};
    wire.on(COMMIT, (args) => new Promise((r) => (release = () => r(boundPair(args, committed)))));
    const out = runJournaledMutation(mutation());
    await vi.waitFor(() => expect(wire.argsOf(COMMIT)).toHaveLength(1));
    const prepPair = pairOf(JSON.parse(wire.payloadsOf(PREPARE)[0]));
    pagehide(true);
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    release();
    expect(await out).toMatchObject({ status: "applied", durable: true });
    expect(content()).toBe("after");
    expect(pairOf(wire.argsOf(COMMIT)[0])).toEqual(prepPair);
    expect(wire.argsOf(ABORT)).toEqual([]);
    expect(wire.argsOf(ABANDON)).toEqual([]);
  });

  it("pagehide during applying → the write still commits on the prepare's pair", async () => {
    prepared();
    wire.on(COMMIT, (args) => boundPair(args, committed));
    const base = mutation();
    const out = await runJournaledMutation(mutation({ apply: (...a) => (pagehide(false), base.apply(...a)) }));
    expect(out).toMatchObject({ status: "applied", durable: true });
    expect(wire.argsOf(COMMIT)).toHaveLength(1);
    expect(pairOf(wire.argsOf(COMMIT)[0])).toEqual(pairOf(JSON.parse(wire.payloadsOf(PREPARE)[0])));
    expect(wire.argsOf(ABORT)).toEqual([]);
    expect(wire.argsOf(ABANDON)).toEqual([]);
  });
});

describe("registration before any dispatch", () => {
  it("a hanging register ends JOURNAL_TIMEOUT with zero prepare invokes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const freeze = source();
    let answer: (v: unknown) => void = () => {};
    wire.on(REGISTER, (args) => new Promise((r) => (answer = () => r({ bind: { pageIdentity: args.pageIdentity }, reply: { incarnation: "0123456789abcdef0123456789abcdef", webviewGeneration: "1", pageIdentity: args.pageIdentity } }))));
    prepared();
    const out = runJournaledMutation(mutation());
    await vi.waitFor(() => expect(registers()).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await out).toMatchObject({ status: "refused", refusal: { journalCode: "JOURNAL_TIMEOUT", uncertain: false } });
    expect(freeze.release).toHaveBeenCalled();
    expect(freeze.invalidate).not.toHaveBeenCalled();
    answer(null);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(wire.payloadsOf(PREPARE)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(content()).toBe("before");
  });

  it("a registration that fails before any dispatch releases the freeze", async () => {
    const freeze = source();
    wire.on(REGISTER, () => Promise.reject(new Error("transport failed")));
    prepared();
    expect(await runJournaledMutation(mutation())).toMatchObject({ status: "refused", refusal: { uncertain: false } });
    expect(freeze.release).toHaveBeenCalled();
    expect(freeze.invalidate).not.toHaveBeenCalled();
    expect(wire.payloadsOf(PREPARE)).toEqual([]);
    expect(wire.argsOf(ABANDON)).toEqual([]);
  });
});

