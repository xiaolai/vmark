/**
 * Link Create Popup DOM Builder
 *
 * Purpose: Shared DOM construction for the link-create popup, used by both
 * the WYSIWYG (LinkCreatePopupView) and Source mode (SourceLinkCreatePopupView)
 * variants. Builds the text row (optional) and the URL row with save/cancel.
 *
 * @coordinates-with LinkCreatePopupView.ts — WYSIWYG consumer
 * @coordinates-with sourceLinkCreatePopup/SourceLinkCreatePopupView.ts — Source mode consumer
 * @module plugins/linkCreatePopup/linkCreateDom
 */

import i18n from "@/i18n";
import { buildPopupIconButton, popupIcons } from "@/utils/popupComponents";

export interface LinkCreateDomHandlers {
  onTextInput: () => void;
  onUrlInput: () => void;
  onInputKeydown: (e: KeyboardEvent) => void;
  onSave: () => void;
  onCancel: () => void;
}

export interface LinkCreateDomRefs {
  /** Present only when showTextInput is true. */
  textInput: HTMLInputElement | null;
  urlInput: HTMLInputElement;
}

/** Build a link-create popup icon button with the popup's bespoke styling. */
function buildLinkCreateBtn(iconSvg: string, title: string, onClick: () => void): HTMLButtonElement {
  return buildPopupIconButton({ iconSvg, title, onClick, baseClass: "link-create-popup-btn" });
}

/**
 * (Re)build the popup content inside `container`.
 * Clears existing children first — the popup is rebuilt on every show
 * because the text row depends on whether a selection existed.
 */
export function buildLinkCreateContent(
  container: HTMLElement,
  showTextInput: boolean,
  handlers: LinkCreateDomHandlers
): LinkCreateDomRefs {
  container.innerHTML = "";

  let textInput: HTMLInputElement | null = null;

  // Text input row (only if no selection)
  if (showTextInput) {
    const textRow = document.createElement("div");
    textRow.className = "link-create-popup-row";

    textInput = document.createElement("input");
    textInput.type = "text";
    textInput.className = "link-create-popup-input link-create-popup-text";
    textInput.placeholder = i18n.t("editor:popup.linkCreate.text.placeholder");
    textInput.autocapitalize = "off";
    textInput.autocomplete = "off";
    textInput.spellcheck = false;
    textInput.addEventListener("input", handlers.onTextInput);
    textInput.addEventListener("keydown", handlers.onInputKeydown);

    textRow.appendChild(textInput);
    container.appendChild(textRow);
  }

  // URL input row with buttons
  const urlRow = document.createElement("div");
  urlRow.className = "link-create-popup-row";

  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.className = "link-create-popup-input link-create-popup-url";
  urlInput.placeholder = i18n.t("editor:popup.linkCreate.url.placeholder");
  urlInput.autocapitalize = "off";
  urlInput.autocomplete = "off";
  urlInput.spellcheck = false;
  urlInput.setAttribute("autocorrect", "off");
  urlInput.addEventListener("input", handlers.onUrlInput);
  urlInput.addEventListener("keydown", handlers.onInputKeydown);

  const saveBtn = buildLinkCreateBtn(
    popupIcons.save,
    i18n.t("editor:popup.linkCreate.create"),
    handlers.onSave
  );
  saveBtn.classList.add("link-create-popup-btn-save");
  const cancelBtn = buildLinkCreateBtn(
    popupIcons.close,
    i18n.t("editor:popup.linkCreate.cancel"),
    handlers.onCancel
  );
  cancelBtn.classList.add("link-create-popup-btn-cancel");

  urlRow.appendChild(urlInput);
  urlRow.appendChild(saveBtn);
  urlRow.appendChild(cancelBtn);

  container.appendChild(urlRow);

  return { textInput, urlInput };
}
