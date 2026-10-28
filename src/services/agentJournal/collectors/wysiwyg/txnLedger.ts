/**
 * WYSIWYG transaction ledger — records every applied ProseMirror transaction
 * of one editor, root and appended alike, without serializing anything, and
 * witnesses that its observation was continuous.
 *
 * Pipeline: the observer plugin's state `apply` → `record` (an edge: before
 * and after documents, step maps, touched ranges) → a flush takes a
 * `boundary` and `chain`s the edges after the previous one → `forget`.
 *
 * Key decisions:
 *   - Every plugin-state value is a witness this ledger issued; it remembers
 *     the last one. A state that did not come from an observed apply of the
 *     last witnessed state is a gap: `init`, a `fork` (apply to another
 *     state), an `install` (the view takes a state the ledger did not
 *     produce last), a `detach` on a state whose observer is not ours, an
 *     `attach` (a plugin view created after the start: the plugin set
 *     changed while live, or the view was rebuilt), a `foreign` apply.
 *   - A gap drops the log, so no earlier boundary chains again, and is
 *     reported to `onGap` at once (the collector breaks the window then, not
 *     at the next flush).
 *   - Every step is an edit, whatever document object it returns: edges are
 *     never skipped by document identity.
 *   - The production start (the first attachment, on the init witness, with
 *     no apply and no boundary since init) is the one attachment that is not
 *     a gap.
 *   - Budgets, enforced at record time before anything is copied: edges
 *     (`CHAIN_CAP`), step maps (`MAX_RETAINED_STEPS`), replaced ranges
 *     (`MAX_RETAINED_RANGES`, one step map may carry any number) and the
 *     mappings that carry one transaction's touched ranges through its later
 *     steps (`MAX_RANGE_MAPPINGS`). Past any of them the log is dropped and
 *     marked capped: a whole-document barrier at the next flush, never a
 *     truncation.
 *   - The plugin key is private to this module; plugin state is not a
 *     capability boundary, so in-process code that deliberately reuses it is
 *     outside the threat model, and the ownership checks still catch it
 *     whenever our plugin view or our apply sees it.
 *
 * @coordinates-with services/agentJournal/collectors/wysiwyg/pmSteps.ts — step geometry
 * @coordinates-with services/agentJournal/collectors/wysiwyg/wysiwygCollector.ts — the flush that chains
 * @module services/agentJournal/collectors/wysiwyg/txnLedger
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { StepMap } from "@tiptap/pm/transform";
import { journalWarn } from "@/utils/debug";
import { MAX_RANGE_MAPPINGS, mapRange, mergeRanges, rangeCount, stepTouched, type Range } from "./pmSteps";

export interface Edge {
  readonly before: PMNode;
  readonly after: PMNode;
  readonly maps: readonly StepMap[];
  /** Ranges the transaction's steps touched, in the after document's coordinates, sorted and merged. */
  readonly touched: readonly Range[];
  readonly unknownSteps: readonly string[];
}

/** The observer's plugin-state value: issued by one ledger, compared by identity only. */
export interface Witness {
  readonly observer: TxnLedger;
}

/** Where a flush's history starts: the ledger's cursor, the document there, and whether its state was the last witnessed one. */
export interface Boundary {
  readonly observer: TxnLedger;
  readonly cursor: number;
  readonly doc: PMNode;
  readonly witnessed: boolean;
}

export type ChainResult = { ok: true; edges: Edge[] } | { ok: false; reason: "unobserved-transaction" | "chain-cap" };

export type GapReason = "init" | "fork" | "install" | "detach" | "attach" | "foreign";

/** Most edges the log holds between two flushes. */
export const CHAIN_CAP = 10_000;
/** Most step maps the log holds between two flushes (the session's entry cap). */
export const MAX_RETAINED_STEPS = 16_384;
/** Most replaced ranges, summed over the log's step maps; the same bound as `MAX_RETAINED_STEPS`. */
export const MAX_RETAINED_RANGES = 16_384;

export interface LedgerBudgets {
  chainCap?: number;
  maxSteps?: number;
  maxRanges?: number;
  maxRangeMappings?: number;
}

const observerKey = new PluginKey<Witness>("vmarkJournalObserver");
const witnessOf = (state: EditorState): unknown => observerKey.getState(state);
/** The ledger each observer plugin instance feeds, and the ledger that issued each witness. */
const owners = new WeakMap<Plugin, TxnLedger>();
const issuers = new WeakMap<object, TxnLedger>();

export class TxnLedger {
  #log: Edge[] = [];
  /** The sequence number the log starts after; each recorded transaction and each gap takes the next one. */
  #floor = 0;
  #seq = 0;
  #capped = false;
  #steps = 0;
  #ranges = 0;
  #last: Witness | null = null;
  #initWitness: Witness | null = null;
  #appliedSinceInit = false;
  #boundarySinceInit = false;
  #attachments = 0;
  readonly #chainCap: number;
  readonly #maxSteps: number;
  readonly #maxRanges: number;
  readonly #maxRangeMappings: number;
  /** Told of every gap as it happens. */
  onGap: ((reason: GapReason) => void) | null = null;

  constructor({
    chainCap = CHAIN_CAP,
    maxSteps = MAX_RETAINED_STEPS,
    maxRanges = MAX_RETAINED_RANGES,
    maxRangeMappings = MAX_RANGE_MAPPINGS,
  }: LedgerBudgets = {}) {
    this.#chainCap = chainCap;
    this.#maxSteps = maxSteps;
    this.#maxRanges = maxRanges;
    this.#maxRangeMappings = maxRangeMappings;
  }

  init(): Witness {
    this.#gap("init");
    this.#appliedSinceInit = this.#boundarySinceInit = false;
    return (this.#initWitness = this.#issue());
  }

  apply(tr: Transaction, prev: unknown): Witness {
    const issuer = issuers.get(prev as object);
    if (issuer !== undefined && issuer !== this) issuer.#gap("foreign");
    if (prev !== this.#last) this.#gap("fork");
    this.#appliedSinceInit = true;
    if (tr.steps.length > 0) this.#record(tr);
    return this.#issue();
  }

  attach(w: unknown): void {
    const first = this.#attachments === 0;
    this.#attachments += 1;
    if (!(first && w === this.#initWitness && !this.#appliedSinceInit && !this.#boundarySinceInit)) this.#gap("attach");
  }

  installed(w: unknown): void {
    if (w !== this.#last) this.#gap("install");
  }

  detach(state: EditorState): void {
    if (!(witnessOf(state) === this.#last && this.#owns(state))) this.#gap("detach");
  }

  /** The ledger's cursor now, at `state`. */
  boundary(state: EditorState): Boundary {
    this.#boundarySinceInit = true;
    return { observer: this, cursor: this.#seq, doc: state.doc, witnessed: witnessOf(state) === this.#last && this.#owns(state) };
  }

  /** The edges after `from`, oldest first, which must lead without a gap from its state to `head` (the current state). */
  chain(from: Boundary, head: EditorState): ChainResult {
    if (from.observer !== this) throw new Error("a boundary taken on another observer");
    if (from.cursor > this.#seq) throw new Error(`boundary ${from.cursor} is ahead of the observer (${this.#seq})`);
    const unobserved = { ok: false, reason: "unobserved-transaction" } as const;
    if (!from.witnessed || witnessOf(head) !== this.#last || !this.#owns(head) || from.cursor < this.#floor) return unobserved;
    if (this.#capped) return { ok: false, reason: "chain-cap" };
    const edges = this.#log.slice(from.cursor - this.#floor);
    let doc = from.doc;
    for (const edge of edges) {
      if (edge.before !== doc) return unobserved;
      doc = edge.after;
    }
    return doc === head.doc ? { ok: true, edges } : unobserved;
  }

  /** Drop every edge up to `cursor` once a flush consumed it. */
  forget(cursor: number): void {
    if (cursor < this.#floor || cursor > this.#seq) throw new Error(`forget(${cursor}) outside [${this.#floor}, ${this.#seq}]`);
    const dropped = this.#capped ? [] : this.#log.splice(0, cursor - this.#floor);
    for (const e of dropped) {
      this.#steps -= e.maps.length;
      for (const m of e.maps) this.#ranges -= rangeCount(m);
    }
    this.#floor = cursor;
    if (this.#capped && cursor === this.#seq) this.#capped = false;
  }

  #owns(state: EditorState): boolean {
    return state.plugins.some((p) => owners.get(p) === this);
  }

  #issue(): Witness {
    this.#last = Object.freeze({ observer: this });
    issuers.set(this.#last, this);
    return this.#last;
  }

  #gap(reason: GapReason): void {
    this.#seq += 1;
    this.#floor = this.#seq;
    this.#log = [];
    this.#steps = this.#ranges = 0;
    this.#capped = false;
    if (reason === "init") return;
    try {
      this.onGap?.(reason);
    } catch (error) {
      journalWarn("wysiwyg provenance: a gap listener failed", error);
    }
  }

  #record(tr: Transaction): void {
    this.#seq += 1;
    if (this.#capped) return;
    const steps = this.#steps + tr.steps.length;
    let ranges = this.#ranges;
    for (const map of tr.mapping.maps) ranges += rangeCount(map);
    if (this.#log.length + 1 > this.#chainCap || steps > this.#maxSteps || ranges > this.#maxRanges) return this.#cap();
    let touched: Range[] = [];
    const unknownSteps: string[] = [];
    let mappings = 0;
    for (let i = 0; i < tr.steps.length; i++) {
      const map = tr.mapping.maps[i];
      mappings += touched.length;
      if (mappings > this.#maxRangeMappings) return this.#cap();
      touched = touched.map((r) => mapRange(r, map));
      const own = stepTouched(tr.steps[i], map);
      if (own === null) unknownSteps.push(tr.steps[i].constructor.name);
      else touched.push(...own);
    }
    this.#log.push({ before: tr.before, after: tr.doc, maps: tr.mapping.maps.slice(), touched: mergeRanges(touched), unknownSteps });
    this.#steps = steps;
    this.#ranges = ranges;
  }

  #cap(): void {
    this.#capped = true;
    this.#log = [];
    this.#steps = this.#ranges = 0;
  }
}

/** The observer plugin: its state is the witness, its view reports installations and teardown. */
export function observerPlugin(ledger: TxnLedger): Plugin<Witness> {
  const plugin: Plugin<Witness> = new Plugin<Witness>({
    key: observerKey,
    state: {
      init: () => ledger.init(),
      apply: (tr, value) => ledger.apply(tr, value),
    },
    view(view) {
      ledger.attach(witnessOf(view.state));
      return {
        update: (v) => ledger.installed(witnessOf(v.state)),
        destroy: () => ledger.detach(view.state),
      };
    },
  });
  owners.set(plugin, ledger);
  return plugin;
}
