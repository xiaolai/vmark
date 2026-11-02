/**
 * Body text selection lock — stops text selecting while a resize or drag gesture
 * crosses the window.
 *
 * Purpose: WebKit ignores the unprefixed property, so a lock that writes only
 * that one does nothing in the macOS webview. Both go through `setProperty`, the
 * form that reaches each engine's real declaration. `lint:user-select` refuses
 * an unprefixed inline write anywhere else.
 *
 * @module utils/bodyTextSelection
 */

const PROPERTIES = ["-webkit-user-select", "user-select"] as const;

/** Stop the page taking a text selection until `allowBodyTextSelection`. */
export function suppressBodyTextSelection(): void {
  for (const property of PROPERTIES) document.body.style.setProperty(property, "none");
}

/** Undo `suppressBodyTextSelection`. Safe to call without a prior suppress. */
export function allowBodyTextSelection(): void {
  for (const property of PROPERTIES) document.body.style.removeProperty(property);
}
