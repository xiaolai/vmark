/**
 * SettingsNav
 *
 * Purpose: the settings window's leading card — the search field and the
 * section list, held in the same card surface the document window's sidebar
 * uses (`shell/app-shell.css`).
 *
 * Split out of `Settings.tsx` when the card pushed that file past the 300-line
 * limit. It is a real seam, not a line-count dodge: this column owns the
 * window's only chrome clearance and its own scroll behaviour, and the page
 * beside it owns neither.
 *
 * @coordinates-with shell/shellChrome.ts — the card inset, radius and top inset
 * @module pages/settings/SettingsNav
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SearchInput } from "./components";
import type { Section } from "./panels";

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      data-active={active}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1
                 text-sm font-medium transition-colors
                 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]
                 data-[active=true]:bg-[var(--accent-bg)]
                 data-[active=true]:text-[var(--text-color)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] focus-visible:outline-offset-2"
    >
      {icon}
      {label}
    </button>
  );
}

export interface SettingsNavProps {
  isMac: boolean;
  items: { id: Section; label: string; icon: ReactNode }[];
  section: Section;
  searching: boolean;
  searchQuery: string;
  onSearch: (value: string) => void;
  onSelect: (id: Section) => void;
}

export function SettingsNav({
  isMac,
  items,
  section,
  searching,
  searchQuery,
  onSearch,
  onSelect,
}: SettingsNavProps) {
  const { t } = useTranslation("settings");
  // The gutter lives on this wrapper so the card's own width stays w-52.
  return (
    <div className="shrink-0 box-border" style={{ padding: "var(--shell-card-inset)" }}>
      <div
        className="w-[var(--settings-nav-width)] h-full flex flex-col overflow-hidden bg-[var(--bg-secondary)]"
        style={{
          borderRadius: "var(--shell-card-radius)",
          boxShadow: "var(--shadow-md)",
        }}
      >
        {/* Clears the traffic lights, measured from the WINDOW's top — so the
            card's own gutter comes off it, exactly as the document window's
            card does. Still a drag region: this strip is the title bar. */}
        {isMac && (
          <div
            data-tauri-drag-region
            className="shrink-0"
            style={{
              height: "max(0px, calc(var(--shell-top-inset) - var(--shell-card-inset)))",
            }}
          />
        )}
        {/* Search box */}
        <div className="px-3 pb-2">
        <SearchInput
          type="search"
          value={searchQuery}
          onChange={onSearch}
          placeholder={t("search.placeholder")}
          aria-label={t("search.placeholder")}
        />
        </div>
        {/* Nav items */}
        <div className="settings-scroll flex-1 overflow-auto px-3 pb-3">
          <div className="space-y-1">
          {items.map((item) => (
            <NavItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              active={!searching && section === item.id}
              onClick={() => {
                onSearch("");
                onSelect(item.id);
              }}
            />
          ))}
          </div>
        </div>
      </div>
    </div>
  );
}
