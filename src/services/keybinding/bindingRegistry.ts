/**
 * Binding registry — the single resolution + precedence authority for keyboard
 * shortcuts (ADR-018, keybinding-unification Phase 1).
 *
 * A declarative registry of `Binding`s indexed by `CanonicalChord`. Capture
 * adapters (window / ProseMirror / CodeMirror / native-menu / WKWebView) all
 * resolve against THIS registry — unify resolution + precedence, not physical
 * listeners. Given a chord + the current `BindingContext` + the asking adapter's
 * `captureOwner`, `resolveBinding` returns the one winning binding (or null).
 *
 * Precedence is independent dimensions, NOT a single total ladder:
 *   1. index by chord;
 *   2. keep bindings owned by the asking adapter;
 *   3. keep bindings whose `scope` is active in the context AND whose `when` holds;
 *   4. pick highest scope-specificity, then highest declared `priority`;
 *   5. an exact tie (same specificity AND same priority) is a REGISTRY ERROR, not
 *      "first registered wins" — the registry must be authored unambiguously.
 *
 * @module services/keybinding/bindingRegistry
 */

import type { CanonicalChord } from "@/utils/keybinding/canonicalChord";

/** Where a chord is captured. Native/WKWebView are capture SOURCES, not scopes. */
export type CaptureOwner =
  | "window"
  | "prosemirror"
  | "codemirror"
  | "native-menu"
  | "wkwebview";

/**
 * The active-context axis. A binding's `scope` must be present in the context's
 * active stack to be eligible; specificity breaks ties (modal beats editor beats
 * window). NOTE both editors are contenteditable, so "input" must NOT out-rank
 * an editor/terminal owner — the specificity ranks below encode that.
 */
export type Scope =
  | "modal"
  | "terminal"
  | "editor-wysiwyg"
  | "editor-source"
  | "input"
  | "panel"
  | "window";

/** Higher = more specific = wins. `input` sits BELOW the editors/terminal. */
const SCOPE_SPECIFICITY: Record<Scope, number> = {
  modal: 60,
  terminal: 50,
  "editor-wysiwyg": 40,
  "editor-source": 40,
  input: 30,
  panel: 20,
  window: 10,
};

export type Consumption = "preventDefault" | "preventAndStop" | "passthrough";
export type Repeat = "deny" | "allow" | "coalesce";
export type Reentrancy = "drop" | "queue" | "parallel";
export type Ime = "block" | "chord-exempt" | "editor-local";

/** Free-form context a capture adapter builds per event. */
export interface BindingContext {
  /** Scopes currently active (order irrelevant; specificity decides). */
  activeScopes: readonly Scope[];
  [key: string]: unknown;
}

interface Policies {
  scope: Scope;
  when?: (ctx: BindingContext) => boolean;
  priority: number;
  captureOwner: CaptureOwner;
  repeat: Repeat;
  reentrancy?: Reentrancy;
  ime: Ime;
  /** DOM listener phase for the `window` capture owner. Default is bubble; a few
   * bindings (browser-default containment, file-explorer pre-emption) must run in
   * the capture phase to beat other handlers. Ignored for editor/native owners. */
  windowPhase?: "capture" | "bubble";
}

/**
 * Every binding needs a chord source to key the index: a rebindable `shortcutId`
 * (resolved through the shortcut store) or a `fixedChord` for non-configurable
 * browser-default guards (e.g. `useSelectAllScope` → `fixedChord: Mod-a`).
 */
export type ChordSource = { shortcutId: string } | { fixedChord: CanonicalChord };

/**
 * `kind: "command"` runs `commandId` through `executeCommand`. `kind:
 * "containment"` executes NOTHING — it only prevents a browser default (so it
 * can't be `passthrough`). Resolution outcome (`execute`/`consumeOnly`/`pass`) is
 * a separate runtime concept, decided by the adapter from the resolved binding.
 */
export type Binding =
  | (Policies & ChordSource & {
      kind: "command";
      commandId: string;
      consumption: Consumption;
    })
  | (Policies & ChordSource & {
      kind: "containment";
      consumption: Exclude<Consumption, "passthrough">;
    });

export interface ResolvedBinding {
  binding: Binding;
  chord: CanonicalChord;
}

export class AmbiguousBindingError extends Error {
  constructor(
    public readonly chord: CanonicalChord,
    public readonly owner: CaptureOwner,
    public readonly scope: Scope,
    public readonly priority: number,
  ) {
    super(
      `Ambiguous binding for chord "${chord}" (owner=${owner}, scope=${scope}, ` +
        `priority=${priority}): two candidates share specificity AND priority. ` +
        `Author distinct priorities or a narrower \`when\`.`,
    );
    this.name = "AmbiguousBindingError";
  }
}

/** A registry is a chord → ordered candidate list. */
export type BindingIndex = Map<CanonicalChord, Binding[]>;

/**
 * Resolve the one winning binding for a chord in a context, for the adapter that
 * owns `owner`. Returns null if nothing applies. Throws `AmbiguousBindingError`
 * on an exact specificity+priority tie among same-owner candidates.
 */
export function resolveBinding(
  index: BindingIndex,
  chord: CanonicalChord,
  ctx: BindingContext,
  owner: CaptureOwner,
): ResolvedBinding | null {
  const candidates = index.get(chord);
  if (!candidates || candidates.length === 0) return null;

  const active = new Set(ctx.activeScopes);
  const eligible = candidates.filter(
    (b) =>
      b.captureOwner === owner &&
      active.has(b.scope) &&
      (b.when ? safeWhen(b, ctx) : true),
  );
  if (eligible.length === 0) return null;

  let best = eligible[0];
  let tie = false;
  for (let i = 1; i < eligible.length; i++) {
    const cmp = compare(eligible[i], best);
    if (cmp > 0) {
      best = eligible[i];
      tie = false;
    } else if (cmp === 0) {
      tie = true;
    }
  }
  if (tie) {
    throw new AmbiguousBindingError(chord, owner, best.scope, best.priority);
  }
  return { binding: best, chord };
}

/** Higher specificity wins; then higher priority. Registration order is NEVER used. */
function compare(a: Binding, b: Binding): number {
  const bySpec = SCOPE_SPECIFICITY[a.scope] - SCOPE_SPECIFICITY[b.scope];
  if (bySpec !== 0) return bySpec;
  return a.priority - b.priority;
}

function safeWhen(b: Binding, ctx: BindingContext): boolean {
  try {
    return b.when!(ctx);
  } catch {
    // A throwing predicate disables only its own binding (mirrors the CommandBus).
    return false;
  }
}

/** Resolve the chord that keys a binding in the index (internal to buildIndex). */
function chordOfBinding(
  b: Binding,
  resolveShortcut: (shortcutId: string) => CanonicalChord | null,
): CanonicalChord | null {
  return "fixedChord" in b ? b.fixedChord : resolveShortcut(b.shortcutId);
}

/**
 * Build a `Map<CanonicalChord, Binding[]>` from bindings, resolving each
 * `shortcutId` to its chord. A binding whose chord can't be resolved (unbound
 * shortcut, unknown id) is dropped and reported via `onDropped` — it never enters
 * the index (referential integrity, WI-1.3).
 */
export function buildIndex(
  bindings: readonly Binding[],
  resolveShortcut: (shortcutId: string) => CanonicalChord | null,
  onDropped?: (binding: Binding, reason: string) => void,
): BindingIndex {
  const index: BindingIndex = new Map();
  for (const binding of bindings) {
    const chord = chordOfBinding(binding, resolveShortcut);
    if (!chord) {
      onDropped?.(
        binding,
        "shortcutId" in binding
          ? `unresolved shortcutId "${binding.shortcutId}"`
          : "missing chord",
      );
      continue;
    }
    const bucket = index.get(chord);
    if (bucket) bucket.push(binding);
    else index.set(chord, [binding]);
  }
  return index;
}
