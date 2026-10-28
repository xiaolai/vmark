// WI-AL2.2g — page registration is lazy, contained and identity-checked: no journal call or timer at import; a mint failure disables the journal with zero invokes and a working bootstrap; the register reply's echo and bind are checked and a mismatch caches nothing; a timed-out or transport-failed register keeps the same identity; a stale answer naming the current pair drains every holder, then registers a fresh identity with replaces = that pair; a non-persisted pagehide closes registration; a persisted one bumps the lifetime and re-registers fresh with replaces, including the pair of a registration that answered only after the pagehide (never orphaned on the journal)
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

vi.unmock("@/services/agentJournal/journalTransport");

import { acquirePage, noteStalePage, pageLifetime, releasePage, resetPageRegistration } from "../pageRegistration";
import { INCARNATION, registered, scriptWire } from "./journalWire";

const REGISTER = "agent_journal_register_page";
const HEX32 = /^[0-9a-f]{32}$/;
const yes = () => true;

/** Fire a `pagehide` on the window the module listens on. */
function pagehide(persisted: boolean): void {
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted }));
}

beforeEach(() => {
  resetPageRegistration();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("page registration — lazy and contained", () => {
  it("no journal call happens before the first write", async () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockClear();
    vi.resetModules();
    await import("../pageRegistration");
    await import("../journalClient");
    await import("../controlledMutation");
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("identity_mint_failure_disables_journal_without_breaking_bootstrap", async () => {
    const wire = scriptWire();
    vi.stubGlobal("crypto", {
      ...globalThis.crypto,
      getRandomValues: () => {
        throw new Error("no entropy");
      },
    });
    vi.resetModules();
    const fresh = await import("../pageRegistration");
    await expect(fresh.acquirePage(yes)).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE", uncertain: false });
    await expect(fresh.acquirePage(yes)).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
    expect(wire.calls).toEqual([]);
  });

  it("registers once, under a 32-hex identity, and shares the registration", async () => {
    const wire = scriptWire();
    const [a, b] = await Promise.all([acquirePage(yes), acquirePage(yes)]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ incarnation: INCARNATION, webviewGeneration: "1" });
    expect(a.pageIdentity).toMatch(HEX32);
    expect(wire.argsOf(REGISTER)).toEqual([{ pageIdentity: a.pageIdentity }]);
  });

  it("keeps the generation an opaque string", async () => {
    const wire = scriptWire();
    wire.state.fixedGeneration = "9007199254740993";
    expect((await acquirePage(yes)).webviewGeneration).toBe("9007199254740993");
  });
});

describe("page registration — reply checks", () => {
  it("the register reply echo mismatch is rejected", async () => {
    const wire = scriptWire();
    wire.on(REGISTER, (args) => ({
      bind: { pageIdentity: args.pageIdentity },
      reply: { incarnation: INCARNATION, webviewGeneration: "1", pageIdentity: "f".repeat(32) },
    }));
    await expect(acquirePage(yes)).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
    wire.on(REGISTER, (args) => registered(args.pageIdentity, "2"));
    const page = await acquirePage(yes);
    const sent = wire.argsOf(REGISTER).map((a) => a.pageIdentity);
    expect(sent).toEqual([page.pageIdentity, page.pageIdentity]);
  });

  it.each<[string, (id: unknown) => unknown]>([
    ["a bind naming another identity", (id) => ({ bind: { pageIdentity: "e".repeat(32) }, reply: { incarnation: INCARNATION, webviewGeneration: "1", pageIdentity: id } })],
    ["a bind with an extra field", (id) => ({ bind: { pageIdentity: id, x: "1" }, reply: { incarnation: INCARNATION, webviewGeneration: "1", pageIdentity: id } })],
    ["no bind", (id) => ({ incarnation: INCARNATION, webviewGeneration: "1", pageIdentity: id })],
    ["a numeric generation", (id) => ({ bind: { pageIdentity: id }, reply: { incarnation: INCARNATION, webviewGeneration: 1, pageIdentity: id } })],
    ["a short incarnation", (id) => registered(id, "1", "abc")],
  ])("%s is malformed and caches nothing", async (_label, reply) => {
    const wire = scriptWire();
    wire.on(REGISTER, (args) => reply(args.pageIdentity));
    await expect(acquirePage(yes)).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
    await expect(acquirePage(yes)).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
    expect(wire.argsOf(REGISTER)).toHaveLength(2);
  });

  it("a timed-out registration is retried with the same identity", async () => {
    vi.useFakeTimers();
    const wire = scriptWire();
    wire.on(REGISTER, () => new Promise(() => {}));
    const first = acquirePage(yes);
    const settled = expect(first).rejects.toMatchObject({ journalCode: "JOURNAL_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(5000);
    await settled;
    wire.on(REGISTER, (args) => registered(args.pageIdentity, "1"));
    const page = await acquirePage(yes);
    expect(wire.argsOf(REGISTER).map((a) => a.pageIdentity)).toEqual([page.pageIdentity, page.pageIdentity]);
  });

  it("a transport-failed registration keeps its identity; a closed window keeps it too", async () => {
    const wire = scriptWire();
    wire.on(REGISTER, () => Promise.reject(new Error("IPC down")));
    await expect(acquirePage(yes)).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
    wire.on(REGISTER, () =>
      Promise.reject({ code: "conflict", message: "STALE_REQUEST", detail: { journalCode: "STALE_REQUEST", uncertain: true, state: "staleGeneration" } }),
    );
    await expect(acquirePage(yes)).rejects.toMatchObject({ journalCode: "STALE_REQUEST" });
    wire.on(REGISTER, (args) => registered(args.pageIdentity, "1"));
    const page = await acquirePage(yes);
    expect(new Set(wire.argsOf(REGISTER).map((a) => a.pageIdentity))).toEqual(new Set([page.pageIdentity]));
  });

  it("a registration nobody still wants is not held", async () => {
    const wire = scriptWire();
    const page = await acquirePage(() => false);
    noteStalePage(page);
    // No holder was counted, so the fresh registration does not wait.
    const next = await acquirePage(yes);
    expect(next.pageIdentity).not.toBe(page.pageIdentity);
    expect(wire.argsOf(REGISTER)).toHaveLength(2);
  });
});

describe("page registration — stale answers and page lifecycle", () => {
  it("the first stale answer naming the current generation marks the registration dead", async () => {
    const wire = scriptWire();
    const old = await acquirePage(yes);
    releasePage();
    noteStalePage({ pageIdentity: old.pageIdentity, webviewGeneration: "999" });
    expect(await acquirePage(yes)).toEqual(old);
    releasePage();
    noteStalePage({ pageIdentity: old.pageIdentity, webviewGeneration: old.webviewGeneration });
    noteStalePage({ pageIdentity: old.pageIdentity, webviewGeneration: old.webviewGeneration });
    const fresh = await acquirePage(yes);
    expect(fresh.pageIdentity).not.toBe(old.pageIdentity);
    expect(fresh.pageIdentity).toMatch(HEX32);
    expect(wire.argsOf(REGISTER).at(-1)).toEqual({
      pageIdentity: fresh.pageIdentity,
      replaces: { pageIdentity: old.pageIdentity, webviewGeneration: old.webviewGeneration },
    });
    expect(wire.argsOf(REGISTER)).toHaveLength(2);
  });

  it("a sealing answer re-registers with replaces only after every phase settles", async () => {
    const wire = scriptWire();
    const old = await acquirePage(yes);
    await acquirePage(yes);
    noteStalePage(old);
    let fresh: unknown = null;
    void acquirePage(yes).then((p) => (fresh = p));
    await new Promise((r) => setImmediate(r));
    expect(wire.argsOf(REGISTER)).toHaveLength(1);
    releasePage();
    await new Promise((r) => setImmediate(r));
    expect(wire.argsOf(REGISTER)).toHaveLength(1);
    releasePage();
    await vi.waitFor(() => expect(fresh).not.toBeNull());
    expect(wire.argsOf(REGISTER).at(-1)?.replaces).toEqual({ pageIdentity: old.pageIdentity, webviewGeneration: old.webviewGeneration });
  });

  it("no registration after a non-persisted pagehide", async () => {
    const wire = scriptWire();
    const before = pageLifetime();
    pagehide(false);
    expect(pageLifetime()).toBe(before + 1);
    await expect(acquirePage(yes)).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE", uncertain: false });
    expect(wire.calls).toEqual([]);
  });

  it("a persisted pagehide re-registers a fresh identity replacing the old pair", async () => {
    const wire = scriptWire();
    const old = await acquirePage(yes);
    releasePage();
    const before = pageLifetime();
    pagehide(true);
    expect(pageLifetime()).toBe(before + 1);
    const fresh = await acquirePage(yes);
    expect(fresh.pageIdentity).not.toBe(old.pageIdentity);
    expect(wire.argsOf(REGISTER).at(-1)).toEqual({
      pageIdentity: fresh.pageIdentity,
      replaces: { pageIdentity: old.pageIdentity, webviewGeneration: old.webviewGeneration },
    });
  });

  it("a registration answered after a persisted pagehide is replaced, not orphaned", async () => {
    const wire = scriptWire();
    let answer!: () => void;
    wire.on(REGISTER, (args) => new Promise((resolve) => (answer = () => resolve(registered(args.pageIdentity, "7")))));
    const first = acquirePage(yes);
    await vi.waitFor(() => expect(wire.argsOf(REGISTER)).toHaveLength(1));
    const late = wire.argsOf(REGISTER)[0].pageIdentity;
    pagehide(true);
    answer();
    await expect(first).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
    wire.on(REGISTER, (args) => registered(args.pageIdentity, "8"));
    const fresh = await acquirePage(yes);
    expect(fresh.pageIdentity).not.toBe(late);
    expect(wire.argsOf(REGISTER).at(-1)).toEqual({
      pageIdentity: fresh.pageIdentity,
      replaces: { pageIdentity: late, webviewGeneration: "7" },
    });
  });
});
