/**
 * BrowserSessionsList — manage saved sessions and named profiles (WI-P6.4/P6.5).
 *
 * The AI reuses logins by handle (session save/load) and by named profile
 * (persistent contexts). This is where the user sees what has been saved and takes
 * it back — "forget" a saved session (clears the keychain blob via
 * `browser_forget_storage_state`) or "remove" a named profile (revokes its on-disk
 * WebKit store via `browser_forget_profile`, so removal actually cancels the login,
 * not just the list row — sec review WI-P6.1 Medium).
 *
 * It shows only metadata (handle/profile name + a value-free count summary) — never
 * a credential value.
 *
 * @coordinates-with stores/browserSessionStore — the metadata registry
 * @coordinates-with src-tauri browser/session_commands.rs — browser_forget_storage_state
 * @coordinates-with src-tauri browser/ai_commands.rs — browser_forget_profile
 * @module components/Browser/BrowserSessionsList
 */
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useBrowserSessionStore } from "@/stores/browserSessionStore";
import "./browser-grants-list.css";

export function BrowserSessionsList(): React.ReactElement {
  const { t } = useTranslation("common");
  const sessions = useBrowserSessionStore((s) => s.sessions);
  const profiles = useBrowserSessionStore((s) => s.profiles);
  // Removal is only reported done once the NATIVE side confirms it (the store row is
  // dropped after the invoke resolves, never before). A failed revocation keeps the
  // row and shows why, so the UI never claims a login is gone while it survives on
  // disk (sec review WI-P6.1 Removal).
  const [error, setError] = useState<string | null>(null);

  const forgetSession = async (handle: string): Promise<void> => {
    setError(null);
    try {
      await invoke("browser_forget_storage_state", { handle });
      useBrowserSessionStore.getState().forgetSession(handle);
    } catch {
      setError(t("browser.sessions.forgetFailed", { handle }));
    }
  };

  const removeProfile = async (name: string): Promise<void> => {
    setError(null);
    try {
      // Await confirmed on-disk revocation BEFORE dropping the registry row, so
      // neither lingers and the row never disappears on an unconfirmed delete.
      await invoke("browser_forget_profile", { profile: name });
      useBrowserSessionStore.getState().removeProfile(name);
    } catch {
      setError(t("browser.profiles.removeFailed", { name }));
    }
  };

  if (sessions.length === 0 && profiles.length === 0) {
    return <p className="browser-grants-empty">{t("browser.sessions.empty")}</p>;
  }

  return (
    <div className="browser-sessions">
      {error !== null && (
        <p className="browser-grants-error" role="alert">
          {error}
        </p>
      )}
      {sessions.length > 0 && (
        <ul className="browser-grants">
          {sessions.map((s) => (
            <li key={s.handle} className="browser-grants-row">
              <div className="browser-grants-origin-block">
                <span className="browser-grants-origin">{s.handle}</span>
                <span className="browser-grants-ops">{s.summary}</span>
              </div>
              <button
                type="button"
                className="browser-grants-revoke"
                aria-label={t("browser.sessions.forgetLabel", { handle: s.handle })}
                onClick={() => void forgetSession(s.handle)}
              >
                {t("browser.sessions.forget")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {profiles.length > 0 && (
        <ul className="browser-grants">
          {profiles.map((p) => (
            <li key={p.name} className="browser-grants-row">
              <div className="browser-grants-origin-block">
                <span className="browser-grants-origin">{p.name}</span>
                <span className="browser-grants-ops">{t("browser.profiles.label")}</span>
              </div>
              <button
                type="button"
                className="browser-grants-revoke"
                aria-label={t("browser.profiles.removeLabel", { name: p.name })}
                onClick={() => void removeProfile(p.name)}
              >
                {t("browser.profiles.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
