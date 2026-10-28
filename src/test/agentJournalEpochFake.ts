/**
 * Test helper — an in-memory stand-in for the agent edit journal's epoch
 * client (`epochClient.ts`) with the writer's rules: one open epoch per
 * document key (a second arm is refused until the first closes), close is
 * a compare-and-set on the epoch, and the arm reply names the settled head
 * of the journal fake with the hash of its text. Releases are recorded.
 *
 * Document identity follows the journal's registry: arm resolves a key's
 * document (minting one on first use), `findDocument` reads it without
 * minting, and a bind moves it — a fresh one when the source has none —
 * after a compare-and-set on the source (`expectedDoc` absent: unchecked;
 * `null`: the source must carry none; an id: it must carry that one). A
 * repeat of the last bind out of a key is a no-op while the destination
 * still holds what it delivered. A bind replies the destination's document. Binds and lookups can be held or failed;
 * a failed one changes nothing. `readJournalHead` reads the journal fake's
 * head of a key (`null` at genesis); head reads can be failed.
 *
 * Use: mocked globally in `globalTestHooks.ts`; drive `agentJournalEpochFake`.
 *
 * @module test/agentJournalEpochFake
 */

import { vi } from "vitest";
import type { ArmedEpoch } from "@/services/agentJournal/epochClient";
import { JournalRefusal } from "@/services/agentJournal/journalRefusal";
import { textHash } from "@/services/agentJournal/provenance/payload";
import { agentJournalFake } from "./agentJournalFake";

/** The last bind out of a key: where it went, what it carried, and whether that was minted. */
interface LastMove {
  to: string;
  doc: string;
  minted: boolean;
}

const refused = () => new JournalRefusal("INVALID_REQUEST", "the source key no longer carries the expected document");

function createEpochFake() {
  const open = new Map<string, string>();
  const released: string[] = [];
  /** Key → document id, as the journal's registry. */
  const registry = new Map<string, string>();
  const moves = new Map<string, LastMove>();
  const minted = new Set<string>();
  let next = 0;
  let mints = 0;
  let armFailures = 0;
  let bindFailures = 0;
  let findFailures = 0;
  let headFailures = 0;
  let heldBind: Promise<void> | null = null;

  /** A new document id: the key itself on first use (what the journal fake reports), unique after. */
  const mint = (docKey: string): string => {
    const doc = minted.has(docKey) ? `${docKey}#${++mints}` : docKey;
    minted.add(doc);
    return doc;
  };

  const resolve = (docKey: string): string => {
    const known = registry.get(docKey);
    if (known !== undefined) return known;
    const doc = mint(docKey);
    registry.set(docKey, doc);
    return doc;
  };

  const bind = (from: string, to: string, expected: string | null | undefined): string => {
    const source = registry.get(from);
    const lastMove = moves.get(from);
    const last = source === undefined && lastMove?.to === to ? lastMove : undefined;
    const held = registry.get(to);
    if ((from === to || last) && held !== undefined) {
      const delivered = last ? last.doc === held : undefined;
      const fits =
        expected === undefined ||
        (expected === null ? delivered === true && last?.minted === true : expected === held && delivered !== false);
      if (!fits) throw refused();
      return held;
    }
    const fits = expected === undefined || (expected === null ? source === undefined : source === expected);
    if (!fits) throw refused();
    const doc = source ?? mint(to);
    registry.delete(from);
    registry.set(to, doc);
    moves.set(from, { to, doc, minted: source === undefined });
    return doc;
  };

  const arm = async (docKey: string): Promise<ArmedEpoch> => {
    if (armFailures > 0) {
      armFailures -= 1;
      throw new JournalRefusal("JOURNAL_UNAVAILABLE", "injected arm failure");
    }
    if (open.has(docKey)) throw new JournalRefusal("INVALID_REQUEST", "an epoch is already armed");
    const epoch = String(++next);
    open.set(docKey, epoch);
    const d = agentJournalFake.doc(docKey);
    const headHash = d.head === null ? null : `sha256-${await textHash(d.text)}`;
    return { doc: resolve(docKey), epoch, head: d.head, headHash };
  };

  const readHead = async (docKey: string): Promise<string | null> => {
    if (headFailures > 0) {
      headFailures -= 1;
      throw new JournalRefusal("JOURNAL_UNAVAILABLE", "injected head read failure");
    }
    return agentJournalFake.doc(docKey).head;
  };

  const close = async (docKey: string, epoch: string): Promise<void> => {
    if (open.get(docKey) !== epoch) throw new JournalRefusal("INVALID_REQUEST", "not the open epoch");
    open.delete(docKey);
  };

  return {
    armEpoch: vi.fn(arm),
    closeEpoch: vi.fn(close),
    releaseWindow: vi.fn(async (window: string) => {
      released.push(window);
    }),
    bindDocument: vi.fn(async (from: string, to: string, expectedDoc?: string | null): Promise<string> => {
      const held = heldBind;
      heldBind = null;
      if (held) await held;
      if (bindFailures > 0) {
        bindFailures -= 1;
        throw new JournalRefusal("JOURNAL_IO", "injected bind failure");
      }
      return bind(from, to, expectedDoc);
    }),
    findDocument: vi.fn(async (docKey: string): Promise<string | null> => {
      if (findFailures > 0) {
        findFailures -= 1;
        throw new JournalRefusal("JOURNAL_UNAVAILABLE", "injected lookup failure");
      }
      return registry.get(docKey) ?? null;
    }),
    readJournalHead: vi.fn(readHead),
    /** The document a key carries in the registry, if any. */
    documentOf: (docKey: string) => registry.get(docKey) ?? null,
    /** Another window resolved `docKey` (arm, capture): it carries a document now, minted if it had none. */
    resolveDocument: (docKey: string) => resolve(docKey),
    /** `docKey` carries document `doc` (a named id a test can assert on). */
    setDocument(docKey: string, doc: string) {
      minted.add(doc);
      registry.set(docKey, doc);
    },
    /** Another window moved `docKey`'s document away and the key was reopened: it carries a new one. */
    reuseDocument(docKey: string): string {
      const doc = mint(docKey);
      registry.set(docKey, doc);
      return doc;
    },
    /** The next `n` lookups fail. */
    failNextFinds(n = 1) {
      findFailures += n;
    },
    /** The next `n` head reads fail. */
    failNextHeads(n = 1) {
      headFailures += n;
    },
    /** The next bind waits until the returned function runs. */
    holdNextBind(): () => void {
      let release: () => void = () => {};
      heldBind = new Promise<void>((resolve) => (release = resolve));
      return release;
    },
    /** The next `n` binds fail. */
    failNextBinds(n = 1) {
      bindFailures += n;
    },
    /** The open epoch of a document key, if any. */
    openEpoch: (docKey: string) => open.get(docKey) ?? null,
    released,
    /** The next `n` arms fail. */
    failNextArms(n = 1) {
      armFailures += n;
    },
    reset() {
      open.clear();
      released.length = 0;
      registry.clear();
      moves.clear();
      minted.clear();
      mints = 0;
      armFailures = 0;
      bindFailures = 0;
      findFailures = 0;
      headFailures = 0;
      heldBind = null;
      this.armEpoch.mockClear();
      this.closeEpoch.mockClear();
      this.releaseWindow.mockClear();
      this.bindDocument.mockClear();
      this.findDocument.mockClear();
      this.readJournalHead.mockReset();
      this.readJournalHead.mockImplementation(readHead);
    },
  };
}

/** The shared fake; reset in `globalTestHooks.ts`. */
export const agentJournalEpochFake = createEpochFake();

/** The module object for `vi.mock("@/services/agentJournal/epochClient", …)`. */
export function epochClientModule() {
  return {
    armEpoch: agentJournalEpochFake.armEpoch,
    closeEpoch: agentJournalEpochFake.closeEpoch,
    releaseWindow: agentJournalEpochFake.releaseWindow,
    bindDocument: agentJournalEpochFake.bindDocument,
    findDocument: agentJournalEpochFake.findDocument,
    readJournalHead: agentJournalEpochFake.readJournalHead,
  };
}
