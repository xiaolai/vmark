/**
 * Provenance session — everything a tab's editors certify about its text
 * between journal records. Collectors (Source mode, WYSIWYG) attach to it
 * and report each transaction; a save or a controlled write freezes the
 * open window into a payload the journal checks against its own texts.
 *
 * Pipeline: attach → edit / defer / gap → freeze(buffer) → payload(basis)
 * → recorded(id) | invalidate() | release(). A recorded freeze is the next
 * window's basis; a released one (the journal admitted nothing) is merged
 * back in front of the window after it; anything else leaves the next
 * window uncertifiable.
 *
 * Key decisions:
 *   - A view is certified only by a certificate its session issued for it
 *     (its owner) while nothing has changed since: a fresh view (a remount,
 *     or a mode switch to a new view) by the one `openView` issued, a
 *     kept-alive view by the one its own detach issued. Each is presented
 *     once and cannot be built from data. No exemption for the first view.
 *   - Fail closed everywhere: a view attached without such a certificate,
 *     a store write no collector announced, a reload, a
 *     collector out of step with the session, a section list that does not
 *     fit, a deferral whose ranges do not tile both texts — each breaks the
 *     whole window, even when the text did not change.
 *   - The first window's basis comes from the arm handshake: the journal's
 *     head when its text hashes the same as the window's, `genesis` for an
 *     empty document with no head, otherwise nothing.
 *   - Epochs are armed lazily (first change or freeze) and closed once
 *     nothing is left to certify; `freezeArmed` (a hunk revert) never arms
 *     one, so a refused revert appends no epoch record; arm and close run on one serialized
 *     chain, and an arm that answers after dispose is closed at once.
 *   - Every freeze, the over-budget one included, takes the session's next
 *     capture id and send turn (`captureId.ts`): seqs reach the journal in order.
 *   - Budgets: at most `maxFrozen` windows frozen and unsettled (past it a
 *     freeze is refused loudly and the next window is uncertifiable), and
 *     the accumulator's entry cap (`capOverflow`).
 *
 * Known limitations: an app crash leaves the epoch armed; the journal turns
 * that into an `unclosedEpoch` barrier at the next open.
 *
 * @coordinates-with services/agentJournal/provenance/epochLease.ts — arming and closing the epoch
 * @coordinates-with services/agentJournal/provenance/window.ts — windows, slots, deferred ranges
 * @coordinates-with services/agentJournal/provenance/windowChain.ts — the open window and a released freeze's copy
 * @coordinates-with services/agentJournal/provenance/certificates.ts — what a view presents to attach
 * @coordinates-with services/agentJournal/provenance/sessionTypes.ts — the collector, freeze and fork contracts
 * @coordinates-with services/agentJournal/provenanceSessions.ts — one session per tab and document
 * @module services/agentJournal/provenance/session
 */

import { EpochLease, type SessionJournal } from "./epochLease";
import { PROVENANCE_CAP, type Provenance } from "./accumulator";
import { captureMinter, type CaptureId, type CaptureTurn } from "./captureId";
import { certificateAuthority, type ViewCertificate } from "./certificates";
import type { Section } from "./pieces";
import type { NamedPayload, ProvenanceCollector, ProvenanceFork, ProvenanceFreeze, SessionOptions } from "./sessionTypes";
import { composeRanges, isDeferredWhole, rangesFit, settleSlot, slotBasis, type BasisSlot, type DeferredOutcome, type ProvenanceWindow } from "./window";
import { certifyWindow, settleHandshake, WindowChain } from "./windowChain";

export type { DeferredOutcome, DeferredRange } from "./window";
export { ViewCertificate } from "./certificates";

export type { SessionJournal } from "./epochLease";
export type { NamedPayload, ProvenanceCollector, ProvenanceFork, ProvenanceFreeze, SessionOptions } from "./sessionTypes";

/** Default bound on windows frozen and not yet settled. */
const MAX_FROZEN_WINDOWS = 8;

interface Deferral {
  owner: object;
  base: string;
  after: string;
  origin: string;
  materialize: (baseText: string) => DeferredOutcome;
}

export class ProvenanceSession {
  #text: string;
  readonly #chain: WindowChain;
  readonly #initial: { pre: string; slot: BasisSlot };
  #deferral: Deferral | null = null;
  #frozen = 0;
  /** Bumped by every change of the text and every break: what a certificate is bound to. */
  #generation = 0;
  readonly #certs = certificateAuthority();
  /** The collector that last changed the text, and the generation it left. */
  #holder: { owner: object | null; at: number } = { owner: null, at: -1 };
  readonly #lease: EpochLease;
  readonly #maxFrozen: number;
  readonly #warn: SessionOptions["warn"];
  readonly #mintCapture: () => { id: CaptureId; turn: CaptureTurn };

  constructor(text: string, journal: SessionJournal, { cap = PROVENANCE_CAP, maxFrozen = MAX_FROZEN_WINDOWS, view = "", warn }: SessionOptions) {
    this.#text = text;
    this.#lease = new EpochLease(journal, { onArmed: (a) => settleHandshake(this.#initial, a), afterArm: () => this.#maybeClose(), warn });
    this.#maxFrozen = maxFrozen;
    this.#warn = warn;
    this.#mintCapture = captureMinter(view);
    this.#chain = new WindowChain(text, cap);
    this.#initial = { pre: text, slot: this.#chain.open.slot };
  }

  /** A certificate for a fresh view of the session's text, created now, that `owner` presents to attach. */
  openView(owner: object): ViewCertificate {
    return this.#certs.issue(owner, this.#generation);
  }

  /** The text the session believes the tab holds. */
  get text(): string {
    return this.#text;
  }

  /** Changes with every change of the text and every break (an uncertified attach included). */
  get mark(): number {
    return this.#generation;
  }

  attach(owner: object, cert: ViewCertificate | null, origin: string): ProvenanceCollector {
    if (this.#certs.redeem(cert, owner, this.#generation)) this.#own(owner);
    else this.#breakWhole("snapshotOnly", `${origin}:attach`);
    let active = true;
    let issued: ViewCertificate | null = null;
    const report = (change: () => void) => {
      if (!active) return;
      change();
      this.#own(owner);
    };
    return {
      edit: (before, sections, after) => report(() => this.#edit(origin, before, sections, after)),
      defer: (after, materialize) => report(() => this.#defer(owner, origin, after, materialize)),
      gap: (gapOrigin) => active && this.#breakWhole("snapshotOnly", gapOrigin),
      holds: () => active && this.#holds(owner),
      // Issued once, on the active-to-inactive transition: a stale collector
      // detached again mints nothing and leaves a live collector's hold alone.
      detach: () => {
        if (issued) return issued;
        active = false;
        if (this.#holder.owner === owner) this.#holder = { owner: null, at: -1 };
        issued = this.#certs.issue(owner, this.#generation);
        return issued;
      },
    };
  }

  #own(owner: object): void {
    this.#holder = { owner, at: this.#generation };
  }

  #holds(owner: object): boolean {
    return this.#holder.owner === owner && this.#holder.at === this.#generation;
  }

  /** The store now holds `text`; a change no collector announced breaks the window. */
  observeStoreText(text: string): void {
    if (text === this.#text) return;
    this.#setText(text);
    this.#breakWhole("snapshotOnly", "store:unobserved-write");
  }

  /** The document was replaced (reload): break even at equal text. */
  observeReload(text: string): void {
    this.#setText(text);
    this.#breakWhole("externalReload", "store:document-replaced");
  }

  freeze(buffer: string): ProvenanceFreeze {
    return this.#freeze(buffer, true);
  }

  /** A freeze that never arms an epoch: `null` unless one is armed or arming already. */
  freezeArmed(buffer: string): ProvenanceFreeze | null {
    return this.#lease.engaged ? this.#freeze(buffer, false) : null;
  }

  #freeze(buffer: string, arm: boolean): ProvenanceFreeze {
    this.#materialize();
    const { id: capture, turn } = this.#mintCapture();
    if (buffer !== this.#text) {
      this.#setText(buffer);
      this.#breakWhole("snapshotOnly", "freeze:unaligned");
    }
    const over = this.#frozen >= this.#maxFrozen;
    const owner = {};
    const frozen = this.#chain.advance(buffer, over ? { kind: "invalid" } : { kind: "pending" }, over ? null : owner);
    if (over) {
      this.#warn("provenance: too many unsettled saves; this one and the next window are snapshot-only");
      return { touched: true, capture, inTurn: turn.run, payload: async () => null, recorded: turn.settle, invalidate: turn.settle, release: turn.settle };
    }
    this.#frozen++;
    if (arm) void this.#lease.ensure();
    const next = this.#chain.open.slot;
    let settled = false;
    const settle = (id: string | null, restore = false) => {
      if (settled) return;
      [settled, this.#frozen] = [true, this.#frozen - 1];
      this.#chain.settle(owner, restore);
      turn.settle();
      settleSlot(next, id);
      this.#maybeClose();
    };
    return {
      touched: frozen.acc.transactions > 0,
      capture,
      inTurn: turn.run,
      payload: (expected) => this.#payload(frozen, buffer, expected, () => settled, arm),
      recorded: settle,
      invalidate: () => settle(null), release: () => settle(null, true),
    };
  }

  /** A controlled write applies `text`; the next window starts on it once its revision is known. */
  fork(text: string): ProvenanceFork {
    this.#deferral = null;
    this.#setText(text);
    const slot = this.#chain.restart(text);
    return { recorded: (id) => settleSlot(slot, id), invalidate: () => settleSlot(slot, null) };
  }

  /** Close any epoch and stop arming; a late arm reply is closed when it lands. */
  dispose(): Promise<void> {
    return this.#lease.dispose();
  }

  /** Resolves once every queued arm and close has finished. */
  idle(): Promise<void> {
    return this.#lease.idle();
  }

  #edit(origin: string, before: string, sections: readonly Section[], after: string): void {
    this.#materialize();
    if (before !== this.#text) {
      if (after === this.#text) return; // a stale view catching up
      this.#setText(after);
      return this.#breakWhole("snapshotOnly", `${origin}:unaligned`);
    }
    this.#setText(after);
    this.#feed((acc) => {
      acc.compose(sections);
      if (acc.lenB !== after.length) throw new Error("sections do not reach the new text");
    }, `${origin}:malformed`);
    void this.#lease.ensure();
  }

  #defer(owner: object, origin: string, after: string, materialize: Deferral["materialize"]): void {
    const base = this.#deferral?.base ?? this.#text;
    this.#deferral = { owner, base, after, origin, materialize };
    this.#setText(after);
    void this.#lease.ensure();
  }

  /** Run the pending deferral; a break it ends in is its collector's own, so a collector holding the text keeps it. */
  #materialize(): void {
    const d = this.#deferral;
    if (!d) return;
    this.#deferral = null;
    const held = this.#holds(d.owner);
    let out: DeferredOutcome = null;
    try {
      out = d.materialize(d.base);
    } catch (error) {
      this.#warn("provenance: deferred range failed", error);
    }
    if (isDeferredWhole(out)) this.#breakWhole(out.whole, out.origin);
    else if (!rangesFit(out, d.base, d.after) || this.#chain.open.acc.lenB !== d.base.length) this.#breakWhole("snapshotOnly", `${d.origin}:unmatched`);
    else this.#feed((acc) => composeRanges(acc, out, d.origin), `${d.origin}:unmatched`);
    if (held) this.#own(d.owner);
  }

  #setText(text: string): void {
    this.#text = text;
    this.#generation++;
  }

  /** Apply `op` to every live window; one that refuses it breaks whole under `origin`. */
  #feed(op: (acc: Provenance) => void, origin: string): void {
    if (this.#chain.feed(op, this.#text.length, origin, this.#warn)) [this.#generation, this.#deferral] = [this.#generation + 1, null];
  }

  #breakWhole(reason: string, origin: string): void {
    this.#generation++;
    this.#deferral = null;
    this.#chain.breakWhole(this.#text.length, reason, origin);
    void this.#lease.ensure();
  }

  /** `settled` is re-read after every await: a freeze settled meanwhile answers no payload. */
  async #payload(w: ProvenanceWindow, post: string, expected: string | null, settled: () => boolean, arm: boolean): Promise<NamedPayload | null> {
    if (settled()) return null;
    const armed = await (arm ? this.#lease.ensure() : this.#lease.current());
    const basis = slotBasis(w.slot);
    if (settled() || !armed || basis === null || (expected !== null && expected !== basis)) return null;
    const named = await certifyWindow(w, basis, post, armed, this.#warn);
    return settled() ? null : named;
  }

  #maybeClose(): void {
    if (this.#frozen > 0 || this.#deferral || this.#chain.open.acc.transactions > 0) return;
    this.#lease.release();
  }
}
