/**
 * Window chain — a provenance session's open capture window and, while the
 * latest freeze is unsettled, a copy of the window it froze: the one place
 * both are fed every change and the one place a release puts that copy back;
 * with the pure steps that certify a frozen window and settle the first
 * window's basis.
 *
 * Key decisions:
 *   - The copy is fed only while the window after it is still the open one.
 *     A later freeze or an apply fork drops it, and a release then puts
 *     nothing back: the window after it stays uncertifiable (fail closed).
 *   - Putting the copy back merges the two windows in order: the copy has
 *     composed every change the window after it took, sticky breaks
 *     included, so the next freeze certifies from the frozen window's own
 *     starting text and basis.
 *
 * @coordinates-with services/agentJournal/provenance/session.ts — the owner
 * @module services/agentJournal/provenance/windowChain
 */

import type { ArmedEpoch } from "../epochClient";
import type { Provenance } from "./accumulator";
import { encodePayload, textHash } from "./payload";
import type { NamedPayload } from "./sessionTypes";
import { openWindow, settleSlot, type BasisSlot, type ProvenanceWindow } from "./window";

interface Carry {
  /** The freeze it belongs to. */
  readonly owner: object;
  readonly successor: ProvenanceWindow;
  readonly window: ProvenanceWindow;
}

export class WindowChain {
  #open: ProvenanceWindow;
  #carry: Carry | null = null;

  constructor(
    text: string,
    private readonly cap: number,
  ) {
    this.#open = openWindow(text, { kind: "handshake" }, cap);
  }

  get open(): ProvenanceWindow {
    return this.#open;
  }

  /** The open window's accumulator, and the copy's while it follows the open window. */
  #accs(): Provenance[] {
    const carry = this.#carry;
    return carry?.successor === this.#open ? [this.#open.acc, carry.window.acc] : [this.#open.acc];
  }

  /** Apply `op` to every live accumulator; one that refuses it breaks whole (to `length`) under `origin`. True when one refused. */
  feed(op: (acc: Provenance) => void, length: number, origin: string, warn: (...args: unknown[]) => void): boolean {
    let refused = false;
    for (const acc of this.#accs()) {
      try {
        op(acc);
      } catch (error) {
        warn("provenance: a change does not compose", error);
        refused = true;
        acc.breakWhole(length, "snapshotOnly", origin);
      }
    }
    return refused;
  }

  /** A whole break in every live accumulator. */
  breakWhole(length: number, reason: string, origin: string): void {
    for (const acc of this.#accs()) acc.breakWhole(length, reason, origin);
  }

  /** Freeze the open window and open the next on `buffer`; a copy is kept for `owner` when given. Returns the frozen window. */
  advance(buffer: string, slot: BasisSlot, owner: object | null): ProvenanceWindow {
    const frozen = this.#open;
    this.#open = openWindow(buffer, slot, this.cap);
    this.#carry = owner && { owner, successor: this.#open, window: { pre: frozen.pre, slot: frozen.slot, acc: frozen.acc.clone() } };
    return frozen;
  }

  /** Start over on `text` (an apply fork); returns the new window's slot. */
  restart(text: string): BasisSlot {
    this.#carry = null;
    this.#open = openWindow(text, { kind: "pending" }, this.cap);
    return this.#open.slot;
  }

  /** Put `owner`'s copy back as the open window, if it still can be; drop it either way. */
  settle(owner: object, restore: boolean): void {
    const carry = this.#carry;
    if (carry?.owner !== owner) return;
    if (restore && carry.successor === this.#open) this.#open = carry.window;
    this.#carry = null;
  }
}

/** The first window's basis from the arm handshake: the head when its text hashes the same, `genesis` for an empty document with no head, else nothing. */
export async function settleHandshake({ pre, slot }: { pre: string; slot: BasisSlot }, { head, headHash }: ArmedEpoch): Promise<void> {
  if (slot.kind !== "handshake") return;
  if (head === null) return settleSlot(slot, pre === "" ? "genesis" : null);
  settleSlot(slot, headHash === `sha256-${await textHash(pre)}` ? head : null);
}

/** The payload certifying frozen window `w` from `basis` to `post` under `armed`, or `null` (warned) when the window does not certify its texts. */
export async function certifyWindow(w: ProvenanceWindow, basis: string, post: string, armed: ArmedEpoch, warn: (...args: unknown[]) => void): Promise<NamedPayload | null> {
  try {
    w.acc.checkTexts(w.pre, post);
    return { basis, payload: await encodePayload({ document: armed.doc, epoch: armed.epoch, basis, pre: w.pre, post, provenance: w.acc }) };
  } catch (error) {
    warn("provenance: window does not certify its texts", error);
    return null;
  }
}
