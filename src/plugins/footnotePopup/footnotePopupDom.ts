// Shared DOM + constants for the footnote hover popup.

import { popupIcons } from "@/utils/popupComponents";

export const AUTOFOCUS_DELAY_MS = 50;
export const BLUR_CHECK_DELAY_MS = 100;
export const DEFAULT_POPUP_WIDTH = 280;
export const DEFAULT_POPUP_HEIGHT = 80;
export const POPUP_GAP_PX = 8;
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

export function createFootnotePopupDom(handlers: FootnotePopupDomHandlers) {
  const container = document.createElement("div");
  container.className = "footnote-popup";
  container.style.display = "none";

  const textarea = document.createElement("textarea");
  textarea.className = "footnote-popup-textarea";
  textarea.placeholder = "Footnote content...";
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

  const gotoBtn = buildIconButton(popupIcons.goto, "Go to definition", handlers.onGoto);
  gotoBtn.classList.add("footnote-popup-btn-goto");
  const saveBtn = buildIconButton(popupIcons.save, "Save (Enter)", handlers.onSave);
  saveBtn.classList.add("footnote-popup-btn-save");
  const deleteBtn = buildIconButton(popupIcons.delete, "Remove footnote", handlers.onDelete);
  deleteBtn.classList.add("footnote-popup-btn-delete");

  btnRow.appendChild(gotoBtn);
  btnRow.appendChild(saveBtn);
  btnRow.appendChild(deleteBtn);
  container.appendChild(btnRow);

  return { container, textarea };
}

function buildIconButton(svg: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "footnote-popup-btn";
  btn.type = "button";
  btn.title = title;
  btn.innerHTML = svg;
  btn.addEventListener("click", onClick);
  return btn;
}

