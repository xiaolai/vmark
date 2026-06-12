/**
 * Provider Switcher Popover
 *
 * Inline popover for switching AI providers directly from the GeniePicker footer.
 * Shows CLI providers (with availability badges) and REST providers (with key hints).
 */

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAiProviderStore, KEY_OPTIONAL_REST } from "@/stores/aiStore";
import { openSettingsWindow } from "@/services/navigation/settingsWindow";
import { Check, Settings } from "lucide-react";
import type { ProviderType } from "@/types/aiGenies";

interface ProviderSwitcherProps {
  onClose(): void;
  onCloseAll(): void;
}

/** Mask an API key for display: show last 4 chars */
function maskKey(key: string): string {
  if (!key || key.length < 5) return "";
  return `\u2022\u2022\u2022\u2022${key.slice(-4)}`;
}

/** Renders an inline popover for switching AI providers from the GeniePicker footer. */
export function ProviderSwitcher({ onClose, onCloseAll }: ProviderSwitcherProps) {
  const { t } = useTranslation("ai");
  const cliProviders = useAiProviderStore((s) => s.cliProviders);
  const restProviders = useAiProviderStore((s) => s.restProviders);
  const activeProvider = useAiProviderStore((s) => s.activeProvider);
  const detecting = useAiProviderStore((s) => s.detecting);
  const containerRef = useRef<HTMLDivElement>(null);

  // Trigger CLI provider detection if not yet populated
  useEffect(() => {
    if (cliProviders.length === 0 && !detecting) {
      useAiProviderStore.getState().detectProviders();
    }
  }, [cliProviders.length, detecting]);

  // Move focus into the menu on open so keyboard users land inside it (A2/A4).
  // Prefer the currently-active provider's item, falling back to the first.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const active = root.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    const first = root.querySelector<HTMLButtonElement>('[role^="menuitem"]');
    (active ?? first)?.focus();
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Defer to avoid catching the opening click
    const timeout = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  // Escape closes just the switcher (stop propagation to prevent closing picker)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      /* v8 ignore next -- @preserve non-Escape key branch: tests only send Escape to this handler */
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const handleSelect = (type: ProviderType) => {
    useAiProviderStore.getState().activateProvider(type);
    onClose();
  };

  const handleOpenSettings = () => {
    onCloseAll();
    openSettingsWindow("integrations");
  };

  // Only show available CLIs and API providers with a key (or key-optional)
  const availableCli = cliProviders.filter((p) => p.available);
  const readyRest = restProviders.filter(
    (p) => !!p.apiKey || KEY_OPTIONAL_REST.has(p.type),
  );

  return (
    <div ref={containerRef} className="provider-switcher" role="menu">
      {/* CLI providers */}
      {availableCli.length > 0 && (
        <div className="provider-switcher-section" role="group" aria-label={t("provider.sectionCli")}>
          <div className="provider-switcher-label">{t("provider.sectionCli")}</div>
          {availableCli.map((p) => (
            <button
              key={p.type}
              type="button"
              role="menuitemradio"
              aria-checked={activeProvider === p.type}
              className="provider-switcher-item"
              onClick={() => handleSelect(p.type)}
            >
              <span className="provider-switcher-check">
                {activeProvider === p.type && <Check size={12} />}
              </span>
              <span className="provider-switcher-name">{p.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* REST providers */}
      {readyRest.length > 0 && (
        <div className="provider-switcher-section" role="group" aria-label={t("provider.sectionApi")}>
          <div className="provider-switcher-label">{t("provider.sectionApi")}</div>
          {readyRest.map((p) => (
            <button
              key={p.type}
              type="button"
              role="menuitemradio"
              aria-checked={activeProvider === p.type}
              className="provider-switcher-item"
              onClick={() => handleSelect(p.type)}
            >
              <span className="provider-switcher-check">
                {activeProvider === p.type && <Check size={12} />}
              </span>
              <span className="provider-switcher-name">{p.name}</span>
              {!KEY_OPTIONAL_REST.has(p.type) && (
                <span className="provider-switcher-key provider-switcher-key--set">
                  {maskKey(p.apiKey)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Settings link */}
      <div className="provider-switcher-footer">
        <button
          type="button"
          role="menuitem"
          className="provider-switcher-settings"
          onClick={handleOpenSettings}
        >
          <Settings size={12} />
          {t("provider.settings")}
        </button>
      </div>
    </div>
  );
}
