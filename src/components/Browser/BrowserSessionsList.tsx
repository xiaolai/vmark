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
import { useTranslation } from "react-i18next";
import { useBrowserSessionStore } from "@/stores/browserSessionStore";
import "./browser-grants-list.css";

export function BrowserSessionsList(): React.ReactElement {
  const { t } = useTranslation("common");
  const sessions = useBrowserSessionStore((s) => s.sessions);
  const profiles = useBrowserSessionStore((s) => s.profiles);

  const forgetSession = (handle: string): void => {
    void invoke("browser_forget_storage_state", { handle }).catch(() => {});
    useBrowserSessionStore.getState().forgetSession(handle);
  };

  const removeProfile = (name: string): void => {
    // Revoke the on-disk store, then drop the registry row (both, so neither lingers).
    void invoke("browser_forget_profile", { profile: name }).catch(() => {});
    useBrowserSessionStore.getState().removeProfile(name);
  };

  if (sessions.length === 0 && profiles.length === 0) {
    return <p className="browser-grants-empty">{t("browser.sessions.empty")}</p>;
  }

  return (
    <div className="browser-sessions">
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
                onClick={() => forgetSession(s.handle)}
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
                onClick={() => removeProfile(p.name)}
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
