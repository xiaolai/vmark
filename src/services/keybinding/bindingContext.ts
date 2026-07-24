/**
 * Binding context resolver — computes the active scope stack for a keypress
 * (ADR-018, keybinding Phase 3). The window capture adapter builds this per
 * event; the registry's resolver filters candidates by active scope + specificity.
 *
 * Scopes are independent context dimensions, not a total order. `window` is
 * always active (the baseline). Both editors are contenteditable, so an editor
 * focus yields `editor-*`, NOT `input` — the resolver checks the editor first.
 *
 * @module services/keybinding/bindingContext
 */

import { useUIStore } from "@/stores/uiStore";
import type { BindingContext, Scope } from "./bindingRegistry";

function isModalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

function isEditorFocused(el: Element | null): boolean {
  return el?.closest?.(".ProseMirror, .cm-editor") != null;
}

function isTerminalFocused(el: Element | null): boolean {
  return el?.closest?.(".xterm, .terminal-container") != null;
}

function isTextInput(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    (el as HTMLElement).isContentEditable === true
  );
}

/** Resolve the active scope stack + carry the window label for command dispatch. */
export function resolveBindingContext(windowLabel: string): BindingContext {
  const scopes: Scope[] = ["window"];
  const el = typeof document !== "undefined" ? document.activeElement : null;

  if (isModalOpen()) scopes.push("modal");
  if (isTerminalFocused(el)) {
    scopes.push("terminal");
  } else if (isEditorFocused(el)) {
    scopes.push(useUIStore.getState().sourceMode ? "editor-source" : "editor-wysiwyg");
  } else if (isTextInput(el)) {
    scopes.push("input");
  }

  return { activeScopes: scopes, windowLabel };
}
