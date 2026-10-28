/**
 * Source collector — reports every CodeMirror transaction of a Source-mode
 * view to its tab's provenance session, ahead of every update listener
 * (including the one that writes the store), so the session certifies
 * exactly the edits the store receives.
 *
 * Pipeline: `createSourceProvenance` when the view's text is read (it takes
 * the session's start certificate then) → the view is built (its plugin
 * instance is created) → `start(view)` → each update: continuity check, then
 * `edit(before, sections, after)` → `stop()` before the view is destroyed.
 *
 * Key decisions:
 *   - A view plugin, not an update listener: CodeMirror runs plugin updates
 *     before listeners, and it destroys and re-creates plugin instances when
 *     the view's state is replaced (`setState`), which no listener sees.
 *     Any plugin instance after the first, and any destroy before `stop()`,
 *     is an immediate whole-window gap (`source:unobserved-transaction`):
 *     even a state swapped out and back, document object and all.
 *   - Continuity by document identity besides: an update whose start
 *     document is not the one last seen is the same gap. A batch whose
 *     changes cancel out (no net change, a new document object) is not.
 *   - A fresh view is certified only by the start certificate taken for this
 *     collector before its document was built, and only when it opened on
 *     the session's text; otherwise it attaches uncertified (`source:attach`).
 *   - While the view is not live (hidden behind WYSIWYG) its changes reach
 *     no store, so it reports none; the show-time full replace and every
 *     store-to-view sync end on the session's text and the session treats
 *     them as a stale view catching up, not as an edit.
 *   - The session is looked up on every live update: when the tab's session
 *     was replaced (save-as), the view re-attaches to the new one
 *     uncertified. A hidden view waits until it is live again, so an
 *     unrelated update while hidden puts no barrier on the new session.
 *   - A report that throws is a gap too: CodeMirror would otherwise disable
 *     the plugin and every later edit would go unreported.
 *   - Budget: one `Text` reference and its string, nothing per transaction.
 *
 * @coordinates-with services/agentJournal/provenanceSessions.ts — the tab's session
 * @coordinates-with components/Editor/SourceEditor.tsx — mounts it, starts and stops it around the view
 * @module services/agentJournal/collectors/sourceCollector
 */

import type { Extension, Text } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { journalWarn } from "@/utils/debug";
import type { ProvenanceCollector, ProvenanceSession, ViewCertificate } from "../provenance/session";
import type { Section } from "../provenance/pieces";
import { provenanceSessionFor } from "../provenanceSessions";

const ORIGIN = "source";
const GAP = `${ORIGIN}:unobserved-transaction`;

export interface SourceProvenance {
  /** Add this to the view's extensions (it runs before every update listener). */
  readonly extension: Extension;
  /** The view exists; attach it. Once. */
  start(view: EditorView): void;
  /** The view is going away. Idempotent. */
  stop(): void;
}

/** One Source view's binding to its tab's session, and the last document it saw. */
class SourceCollectorState {
  readonly #owner = {};
  readonly #tabId: string | undefined;
  readonly #isLive: () => boolean;
  /** The session open when the view's text was read, and its start certificate. */
  readonly #opened: ProvenanceSession | null;
  readonly #token: ViewCertificate | null;
  #view: EditorView | null = null;
  #instances = 0;
  #bound: ProvenanceSession | null = null;
  #collector: ProvenanceCollector | null = null;
  #seen: Text | null = null;
  #seenText = "";

  constructor(tabId: string | undefined, isLive: () => boolean) {
    this.#tabId = tabId;
    this.#isLive = isLive;
    this.#opened = tabId ? provenanceSessionFor(tabId) : null;
    this.#token = this.#opened?.openView(this.#owner) ?? null;
  }

  /** Attach to `session` (none: detached), with the start certificate only when `certified`. */
  #bind(session: ProvenanceSession | null, certified: boolean): void {
    this.#collector?.detach();
    this.#bound = session;
    this.#collector = session ? session.attach(this.#owner, certified ? this.#token : null, ORIGIN) : null;
  }

  gap(why: string): void {
    journalWarn("source provenance:", why);
    this.#collector?.gap(GAP);
  }

  /** A plugin instance was created; any after the first replaced the view's state. */
  instanceCreated(): void {
    this.#instances++;
    if (this.#view && this.#instances > 1) this.gap("the view's state was replaced");
  }

  /** A plugin instance was destroyed; while attached, that is a gap. */
  instanceDestroyed(): void {
    if (this.#view) this.gap("the plugin was destroyed while attached");
  }

  update(update: ViewUpdate): void {
    if (update.view !== this.#view || !this.#tabId) return;
    // @edge-case A hidden view reports nothing, so it follows a replaced
    // session (save-as) only once live: attaching while hidden would put an
    // uncertified barrier on a session this view never edited.
    if (this.#isLive()) {
      const current = provenanceSessionFor(this.#tabId);
      if (current !== this.#bound) this.#bind(current, false);
    }
    const doc = update.state.doc;
    if (update.startState.doc !== this.#seen) {
      this.gap("a transaction the collector did not see");
      this.#seenText = update.startState.doc.toString();
    }
    if (!update.docChanged) {
      if (doc !== this.#seen) this.#seenText = doc.toString();
      this.#seen = doc;
      return;
    }
    const before = this.#seenText;
    this.#seen = doc;
    this.#seenText = doc.toString();
    if (!this.#isLive()) return;
    const sections: Section[] = [];
    // Individual sections: joined ranges would map a touching boundary to the joined replacement's ends.
    update.changes.iterChanges((fromA, toA, fromB, toB) => sections.push({ fromA, toA, fromB, toB }), true);
    this.#collector?.edit(before, sections, this.#seenText);
  }

  start(view: EditorView): void {
    if (this.#view || !this.#tabId) return;
    this.#view = view;
    this.#seen = view.state.doc;
    this.#seenText = this.#seen.toString();
    const current = provenanceSessionFor(this.#tabId);
    const opensOnSession = current !== null && current === this.#opened && current.text === this.#seenText;
    this.#bind(current, this.#instances === 1 && opensOnSession);
  }

  stop(): void {
    this.#collector?.detach();
    this.#collector = null;
    this.#bound = null;
    this.#view = null;
  }
}

/** A collector for tab `tabId`'s Source view; `isLive()` is false while the view's edits reach no store. */
export function createSourceProvenance(tabId: string | undefined, isLive: () => boolean): SourceProvenance {
  const state = new SourceCollectorState(tabId, isLive);
  const plugin = ViewPlugin.define(() => {
    state.instanceCreated();
    return {
      update(update: ViewUpdate) {
        try {
          state.update(update);
        } catch (error) {
          state.gap(`a report failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      destroy: () => state.instanceDestroyed(),
    };
  });
  return {
    extension: plugin,
    start: (view) => state.start(view),
    stop: () => state.stop(),
  };
}
