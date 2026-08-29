/**
 * Footnote Popup DOM Helpers
 *
 * Purpose: Shared DOM construction and layout constants for the footnote hover popup.
 * Extracted from FootnotePopupView to keep the view class focused on behavior.
 *
 * Key decisions:
 *
 * - **Buttons carry `.popup-icon-btn`, the canonical class (WI-DP4.1).** They
 *   used to carry `.footnote-popup-btn`, which re-declared that surface with no
 *   differing value. The `-goto` / `-save` / `-delete` suffixes REMAIN — the
 *   view and its tests query by them, and `-save` / `-delete` still carry the
 *   local hover accents.
 *
 * @coordinates-with FootnotePopupView.ts — consumes these helpers for popup construction
 * @coordinates-with src/styles/icon-button-shared.css — owns `.popup-icon-btn`
 * @module plugins/footnotePopup/footnotePopupDom
 */

import i18n from "@/i18n";
import { popupIcons } from "@/utils/popupComponents";

/** Delay in ms before auto-focusing the textarea after popup appears. */
export const AUTOFOCUS_DELAY_MS = 50;
/** Delay in ms before checking if the popup should close after a blur event. */
export const BLUR_CHECK_DELAY_MS = 100;
/** Default width in px for the footnote popup container. */
export const DEFAULT_POPUP_WIDTH = 280;
/** Default height in px for the footnote popup container. */
export const DEFAULT_POPUP_HEIGHT = 80;
/** Gap in px between the footnote marker and the popup. */
export const POPUP_GAP_PX = 8;
/** Maximum height in px for the footnote content textarea. */
export const TEXTAREA_MAX_HEIGHT = 120;

interface FootnotePopupDomHandlers {
  onInputChange: () => void;
  onInputKeydown: (e: KeyboardEvent) => void;
  onTextareaClick: () => void;
  onTextareaBlur: () => void;
  onGoto: () => void;
  onSave: () => void;
  onDelete: () => void;
}

/** Creates the footnote popup DOM structure with textarea and action buttons. */
export function createFootnotePopupDom(handlers: FootnotePopupDomHandlers) {
  const container = document.createElement("div");
  container.className = "popup-container footnote-popup";
  container.style.display = "none";

  const textarea = document.createElement("textarea");
  textarea.className = "footnote-popup-textarea";
  textarea.placeholder = i18n.t("editor:popup.footnote.content.placeholder");
  textarea.rows = 2;
  textarea.addEventListener("input", handlers.onInputChange);
  textarea.addEventListener("keydown", handlers.onInputKeydown);
  textarea.addEventListener("click", handlers.onTextareaClick);
  textarea.addEventListener("blur", handlers.onTextareaBlur);
  container.appendChild(textarea);

  const btnRow = document.createElement("div");
  btnRow.className = "footnote-popup-buttons";

  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  btnRow.appendChild(spacer);

  const gotoBtn = buildIconButton(popupIcons.goto, i18n.t("editor:popup.footnote.goToDefinition"), handlers.onGoto);
  gotoBtn.classList.add("footnote-popup-btn-goto");
  const saveBtn = buildIconButton(popupIcons.save, i18n.t("editor:popup.footnote.save"), handlers.onSave);
  saveBtn.classList.add("popup-icon-btn--primary", "footnote-popup-btn-save");
  const deleteBtn = buildIconButton(popupIcons.delete, i18n.t("editor:popup.footnote.remove"), handlers.onDelete);
  deleteBtn.classList.add("popup-icon-btn--danger", "footnote-popup-btn-delete");

  btnRow.appendChild(gotoBtn);
  btnRow.appendChild(saveBtn);
  btnRow.appendChild(deleteBtn);
  container.appendChild(btnRow);

  return { container, textarea };
}

function buildIconButton(svg: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  // WI-DP4.1: the canonical popup button. `.footnote-popup-btn` re-declared
  // `.popup-icon-btn` with no differing value; the `-goto`/`-save`/`-delete`
  // suffixes below stay because the view and its tests query by them.
  btn.className = "popup-icon-btn";
  btn.type = "button";
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.innerHTML = svg;
  btn.addEventListener("click", onClick);
  return btn;
}

