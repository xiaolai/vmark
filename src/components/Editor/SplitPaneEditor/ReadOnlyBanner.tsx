// WI-4.2 — Read-only banner above the source pane for kind="viewer"
// formats. Mounts when the active tab's effective read-only state is
// true; hides itself when editing is enabled (caller toggles `hidden`).
//
// "Enable editing" promotes the tab to read-write via the caller's
// onEnableEditing handler (WI-4.3). "Open in external editor"
// dispatches to the Tauri command (WI-4.4); the button is hidden if
// the caller doesn't supply onOpenExternal.

import { useTranslation } from "react-i18next";
import "./read-only-banner.css";

export interface ReadOnlyBannerProps {
  /** i18n key for the format's name (e.g. "format.codeRust"). */
  formatNameI18nKey: string;
  /** Called when the user clicks "Enable editing". */
  onEnableEditing: () => void;
  /** Called when the user clicks "Open in external editor". Hide the
   *  button by omitting this prop. */
  onOpenExternal?: () => void;
  /** Hide the banner entirely (caller toggles when editing is enabled). */
  hidden?: boolean;
}

export function ReadOnlyBanner({
  formatNameI18nKey,
  onEnableEditing,
  onOpenExternal,
  hidden = false,
}: ReadOnlyBannerProps) {
  const { t } = useTranslation("editor");
  // Format names live in the `common` namespace (src/locales/en/common.json
  // — keys like format.markdown / format.codeRust). useTranslation defaults
  // to "common" too, but we passed "editor" for the readOnly.* keys; need
  // to resolve format names from common explicitly.
  const { t: tCommon } = useTranslation("common");
  if (hidden) return null;
  return (
    <div className="read-only-banner" role="status">
      <span className="read-only-banner__label">
        {t("readOnly.label", { format: tCommon(formatNameI18nKey) })}
      </span>
      <div className="read-only-banner__actions">
        <button
          type="button"
          className="read-only-banner__btn"
          onClick={onEnableEditing}
        >
          {t("readOnly.enableEditing")}
        </button>
        {onOpenExternal && (
          <button
            type="button"
            className="read-only-banner__btn"
            onClick={onOpenExternal}
          >
            {t("readOnly.openExternal")}
          </button>
        )}
      </div>
    </div>
  );
}

export default ReadOnlyBanner;
