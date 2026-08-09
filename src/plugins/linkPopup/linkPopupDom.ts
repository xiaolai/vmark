/**
 * Link popup DOM factory.
 *
 * Purpose: build the popup's markup (input + open/copy/save/delete buttons).
 * Split out of LinkPopupView so the view file carries behavior only.
 * Event listeners are attached by the view, not here.
 *
 * Key decisions:
 *
 * - **Buttons carry `.popup-icon-btn`, the canonical class (WI-DP4.1).** They
 *   used to carry `.link-popup-btn`, which re-declared that surface with zero
 *   differing declarations. The per-button suffix classes
 *   (`link-popup-btn-open`, `-copy`, `-save`, `-delete`) REMAIN: `LinkPopupView`
 *   and its tests query the DOM by them, and `-save` / `-delete` still carry the
 *   primary / danger hover accents. So the base surface is shared and only the
 *   genuinely local part is local.
 *
 * - Reach for `buildPopupIconButton` (`@/utils/popupComponents`) for any new
 *   button here; it already defaults to the canonical class, and overriding
 *   `baseClass` is how the duplicate arose in the first place.
 *
 * @coordinates-with LinkPopupView.ts — the sole consumer
 * @coordinates-with src/styles/popup-shared.css — owns `.popup-icon-btn`
 * @module plugins/linkPopup/linkPopupDom
 */

import i18n from "@/i18n";
import { popupIcons } from "@/utils/popupComponents";

/** An icon button with no click handler (the view attaches it). */
function buildButton(iconSvg: string, title: string, className: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  // WI-DP4.1: the canonical popup button. `.link-popup-btn` was a
  // byte-identical duplicate of `.popup-icon-btn`; the suffix classes below
  // stay because the view and its tests query by them.
  btn.className = `popup-icon-btn ${className}`;
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
