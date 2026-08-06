/**
 * Purpose: the live editor views the host has mounted.
 *
 * The sixth seam, and the only one about the editors THEMSELVES rather than
 * what is configured, which document is open, or what chrome to show.
 *
 * It exists for `toolbarActions`, whose whole job is to act on whichever
 * surface the user is looking at. That is ambient by nature: the toolbar is
 * app chrome mounted outside either editor, so it cannot be handed a view as
 * a parameter the way a ProseMirror plugin can.
 *
 * The defaults are EMPTY views — no editor mounted. Every caller already
 * guards on a null view (a toolbar click before the editor mounts is a real
 * case), so a standalone consumer gets a toolbar that accepts no action
 * rather than one that crashes.
 *
 * @coordinates-with services/assembly/bindHostSettings.ts — the app's binding
 * @coordinates-with plugins/toolbarActions/dispatch.ts — the only consumer
 * @module plugins/shared/hostEditors
 */

/** One surface's live state. Shapes are opaque: the toolbar passes them on. */
interface HostEditorSurface {
  editorView: unknown;
  editor?: unknown;
  context?: unknown;
}

/** The editors a plugin can act on. */
export interface HostEditors {
  source: () => HostEditorSurface;
  wysiwyg: () => HostEditorSurface;
  /**
   * The source view that currently has focus, across split panes.
   *
   * Distinct from `source().editorView`: a split layout has more than one
   * CodeMirror view, and lint decorations must target the focused one.
   */
  activeSourceView: () => unknown;
  /**
   * Report the cursor context for a source view.
   *
   * A WRITE, shaped as "report" for the same reason as
   * `hostDocument.reportCursorInfo`: the plugin computes the context, the
   * host decides what to do with it.
   */
  reportSourceContext: (context: unknown, view: unknown) => void;
}

const EMPTY: HostEditorSurface = { editorView: null, editor: null, context: null };

/** No editor mounted — callers already treat a null view as "not ready". */
const DEFAULTS: HostEditors = {
  source: () => EMPTY,
  wysiwyg: () => EMPTY,
  activeSourceView: () => null,
  reportSourceContext: () => {},
};

let bound: HostEditors = DEFAULTS;

/** Bind the host's editors. Called once, at app startup. */
export function bindHostEditors(editors: Partial<HostEditors>): void {
  bound = { ...DEFAULTS, ...editors };
}

/** Restore defaults. Tests only. */
export function resetHostEditors(): void {
  bound = DEFAULTS;
}

/** The bound editors, read through accessors so they are never captured stale. */
export const hostEditors: HostEditors = {
  source: () => bound.source(),
  wysiwyg: () => bound.wysiwyg(),
  activeSourceView: () => bound.activeSourceView(),
  reportSourceContext: (context, view) => bound.reportSourceContext(context, view),
};
