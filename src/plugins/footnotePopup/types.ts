/**
 * Purpose: re-export the footnote popup's state PORT.
 *
 * The shape itself lives in `plugins/shared/popupPorts.ts` because the
 * Source-mode twin drives the same state, and a plugin may not import a
 * sibling's module. This file keeps the local import path stable.
 *
 * @coordinates-with plugins/shared/popupPorts.ts — the declaration
 * @module plugins/footnotePopup/types
 */

export type { FootnotePopupState } from "@/plugins/shared/popupPorts";
