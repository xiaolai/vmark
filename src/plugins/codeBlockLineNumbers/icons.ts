/**
 * Inline SVG icon constants for the code block node view.
 *
 * Sizing matches the surrounding chrome (14×14). Stroke is `currentColor` so
 * the success/error/default states can be styled via CSS.
 *
 * @module plugins/codeBlockLineNumbers/icons
 */

/** Lucide copy icon (14×14) */
export const COPY_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

/** Lucide check icon (14×14) — shown briefly after a successful clipboard write */
export const CHECK_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

/** Lucide x icon (14×14) — shown when clipboard write fails or the API is unavailable */
export const X_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
