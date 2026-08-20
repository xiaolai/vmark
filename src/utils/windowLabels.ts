/**
 * Window-label predicates.
 *
 * Purpose: one definition of "which window is this", so the checks cannot drift
 * as window kinds are added. Rust names the launch window `main` and every
 * other document window `doc-N`; settings and pdf-export windows are neither.
 *
 * These were open-coded at nine sites in `WindowContext` alone (`label ===
 * "main"` five times, `startsWith("doc-")` four), which is how a new window
 * kind would have been classified correctly in some branches and not others.
 *
 * Leaf-pure by ADR-013: no stores, no Tauri APIs — just the label.
 *
 * @module utils/windowLabels
 */

/** The launch window — the one the app opens with. */
export const isLaunchWindow = (label: string): boolean => label === "main";

/** A document window (launch or `doc-N`), as opposed to settings / pdf-export. */
export const isDocumentWindowLabel = (label: string): boolean =>
  isLaunchWindow(label) || label.startsWith("doc-");
