// @vitest-environment node
// WI-AL2.1b — the declared script of a whole-text agent write: the budgeted canonical diff composed into a certificate, the trimmed fallback when the worker is unavailable, the entry-cap boundary (16,384 composes, 16,385 sends none and warns with its reason)
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/utils/debug", () => ({ journalWarn: vi.fn() }));
import { journalWarn } from "@/utils/debug";
import { Provenance, PROVENANCE_CAP } from "../../provenance/accumulator";
import { certificateOf } from "../../selectionCertificate";
import { BudgetedDiff } from "../budgetedDiff";
import type { TextChange } from "../textChanges";
import { declaredScriptCertificate } from "../declaredScript";
import { fakeFactory } from "./fakeDiffWorker";

beforeEach(() => vi.mocked(journalWarn).mockReset());

/** A budgeted diff whose fake workers come up ready and answer like the real one. */
function answeringDiff(): BudgetedDiff {
  const f = fakeFactory();
  f.onSpawn = (w) => {
    w.onPost = (req) => queueMicrotask(() => w.answer(req));
    queueMicrotask(() => w.ready());
  };
  return new BudgetedDiff({ factory: f.factory, warn: () => {} });
}

/** A budgeted diff that cannot spawn: every call gets the trimmed fallback. */
function unavailableDiff(): BudgetedDiff {
  const f = fakeFactory();
  f.throwOnSpawn = new Error("refused by CSP");
  return new BudgetedDiff({ factory: f.factory, warn: () => {} });
}

const expected = (pre: string, post: string, changes: TextChange[]) =>
  certificateOf(pre, post, new Provenance(pre.length).compose(changes));

const FAR = "ABCDEFGhIJKLMNO";

describe("declaredScriptCertificate", () => {
  it.each<[string, string, string, TextChange[]]>([
    ["a supplementary-plane replacement widens to the whole code point", "a😀b", "a😁b", [{ fromA: 1, toA: 3, fromB: 1, toB: 3 }]],
    ["touching changes merge into one run", "😀😀", "😁😁", [{ fromA: 0, toA: 4, fromB: 0, toB: 4 }]],
    ["separate changes stay separate runs", "ab12cd", "aX12Yd", [{ fromA: 1, toA: 2, fromB: 1, toB: 2 }, { fromA: 4, toA: 5, fromB: 4, toB: 5 }]],
    ["a far copy keeps the original and inserts the copy", `${FAR}X`, `${FAR}Y${FAR}`, [{ fromA: 15, toA: 16, fromB: 15, toB: 31 }]],
    ["CJK text maps unit for unit", "甲乙丙丁", "甲辛丙丁", [{ fromA: 1, toA: 2, fromB: 1, toB: 2 }]],
    ["an empty preimage is one insertion", "", "新", [{ fromA: 0, toA: 0, fromB: 0, toB: 1 }]],
  ])("sends the exact script: %s", async (_label, pre, post, changes) => {
    const cert = await declaredScriptCertificate(pre, post, { diff: answeringDiff() });
    expect(cert).toEqual(await expected(pre, post, changes));
    expect(journalWarn).not.toHaveBeenCalled();
  });

  it("sends the trimmed script when the worker is unavailable", async () => {
    const cert = await declaredScriptCertificate("a😀b", "a😁b", { diff: unavailableDiff() });
    expect(cert).toEqual(await expected("a😀b", "a😁b", [{ fromA: 1, toA: 3, fromB: 1, toB: 3 }]));
  });

  it("sends an identity certificate for an unchanged text", async () => {
    const cert = await declaredScriptCertificate("same", "same", { diff: answeringDiff() });
    expect(cert).toEqual(await expected("same", "same", []));
  });

  describe("the entry cap", () => {
    // k spaced one-unit substitutions compose to k + 2 entries.
    const spaced = (k: number, unit: string) => Array.from({ length: k }, () => `${unit}.`).join("");
    const substitutions = (k: number): TextChange[] =>
      Array.from({ length: k }, (_, i) => ({ fromA: 2 * i, toA: 2 * i + 1, fromB: 2 * i, toB: 2 * i + 1 }));
    /** A diff that answers `changes` exactly, as the worker would for these texts. */
    const scripted = (changes: TextChange[]) => ({
      diff: () => Promise.resolve({ mode: "exact" as const, changes, elapsedMs: 0, readyWaitMs: 0, dispatched: true, ownMs: 0 }),
    });

    it("composes a script of exactly PROVENANCE_CAP entries", async () => {
      const k = PROVENANCE_CAP - 2;
      const pre = spaced(k, "a");
      const post = spaced(k, "b");
      const changes = substitutions(k);
      expect(new Provenance(pre.length).compose(changes).entries).toBe(PROVENANCE_CAP);
      const cert = await declaredScriptCertificate(pre, post, { diff: scripted(changes) });
      expect(cert).toEqual(await expected(pre, post, changes));
      expect(journalWarn).not.toHaveBeenCalled();
    });

    it("sends no certificate one entry over, and warns with the reason", async () => {
      const k = PROVENANCE_CAP - 1;
      const cert = await declaredScriptCertificate(spaced(k, "a"), spaced(k, "b"), { diff: scripted(substitutions(k)) });
      expect(cert).toBeNull();
      expect(journalWarn).toHaveBeenCalledWith(expect.stringContaining("capOverflow"));
    });
  });
});
