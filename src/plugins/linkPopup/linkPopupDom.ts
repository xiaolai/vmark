/**
 * Link popup DOM factory.
 *
 * Purpose: build the popup's markup (input + open/copy/save/delete buttons).
 * Split out of LinkPopupView so the view file carries behavior only.
 * Event listeners are attached by the view, not here.
 *
 * @coordinates-with LinkPopupView.ts — the sole consumer
 * @module plugins/linkPopup/linkPopupDom
 */

import i18n from "@/i18n";
import { popupIcons } from "@/utils/popupComponents";

/** An icon button with no click handler (the view attaches it). */
function buildButton(iconSvg: string, title: string, className: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `link-popup-btn ${className}`;
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.innerHTML = iconSvg;
  return btn;
}

/** The popup container: URL input followed by the four action buttons. */
export function buildLinkPopupContainer(): HTMLElement {
  const container = document.createElement("div");
  container.className = "link-popup";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "link-popup-input";
  input.placeholder = i18n.t("editor:popup.link.url.placeholder");
  input.autocapitalize = "off";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("autocorrect", "off");

  container.appendChild(input);
  container.appendChild(
    buildButton(popupIcons.open, i18n.t("editor:popup.link.openLink"), "link-popup-btn-open")
  );
  container.appendChild(
    buildButton(popupIcons.copy, i18n.t("editor:popup.link.copyUrl"), "link-popup-btn-copy")
  );
  container.appendChild(
    buildButton(popupIcons.save, i18n.t("editor:popup.link.save"), "link-popup-btn-save")
  );
  container.appendChild(
    buildButton(popupIcons.delete, i18n.t("editor:popup.link.remove"), "link-popup-btn-delete")
  );

  return container;
}
