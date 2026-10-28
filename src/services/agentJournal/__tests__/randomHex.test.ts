// @vitest-environment node
// WI-AL2.2g — one random-hex source for the journal's identities: a page without a working random source still imports every journal module, mints no window name, and a save there is reported not recorded (JOURNAL_UNAVAILABLE) without a journal call
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/utils/debug", () => ({ journalWarn: vi.fn() }));

import { randomHex } from "../randomHex";

const brokenCrypto = () =>
  vi.stubGlobal("crypto", {
    ...globalThis.crypto,
    getRandomValues: () => {
      throw new Error("no entropy");
    },
  });

afterEach(() => vi.unstubAllGlobals());

describe("randomHex", () => {
  it("answers 2 lowercase hex digits per byte, fresh each call", () => {
    expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/);
    expect(randomHex(4)).toMatch(/^[0-9a-f]{8}$/);
    expect(randomHex(16)).not.toBe(randomHex(16));
  });

  it("answers null when no random source works", () => {
    brokenCrypto();
    expect(randomHex(16)).toBeNull();
  });
});

describe("a page without a random source", () => {
  it("imports the window-name module and mints no name", async () => {
    brokenCrypto();
    vi.resetModules();
    const fresh = await import("../journalWindowName");
    expect(fresh.mintJournalWindowName("main", "t1")).toBeNull();
  });

  it("reports a save not recorded, with no journal call", async () => {
    brokenCrypto();
    vi.resetModules();
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockClear();
    const { useDocumentStore } = await import("@/stores/documentStore");
    const { beginJournalSave } = await import("../saveJournal");
    useDocumentStore.getState().initDocument("t1", "x", "/a.md");
    const out = await beginJournalSave("t1", "/a.md", "x", { saveType: "manual" }).record();
    expect(out).toEqual({ journaled: "no", revision: null, reason: "JOURNAL_UNAVAILABLE" });
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });
});
