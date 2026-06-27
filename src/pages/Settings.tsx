/**
 * Settings Page
 *
 * Main settings window with navigation sidebar.
 * Sections sorted alphabetically.
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Palette,
  Type,
  FolderOpen,
  Zap,
  Languages,
  FileText,
  Files,
  Keyboard,
  Plug,
  SquareTerminal,
  Info,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTheme } from "@/hooks/useTheme";
import { useUpdateBroadcast, useUpdateListener } from "@/hooks/useUpdateSync";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";
import { isMacPlatform } from "@/utils/platform";
import { SettingsSearchContext } from "./settings/SettingsSearchContext";
import { SettingsSearchResults, type SearchablePanel } from "./settings/SettingsSearchResults";
import { SearchInput } from "./settings/components";
import { SETTINGS_PANELS, SEARCHABLE_PANEL_IDS, type Section } from "./settings/panels";
import "./settings/settings-search.css";

// Hook to handle Cmd+W for settings window
function useSettingsClose() {
  useEffect(() => {
    const currentWindow = getCurrentWebviewWindow();

    // Note: menu:close now includes target window label in payload
    // Settings window should only close when it's the target
    const unlistenPromise = listen<string>("menu:close", async (event) => {
      if (event.payload === "settings") {
        await currentWindow.close();
      }
    });

    return () => {
      safeUnlistenAsync(unlistenPromise);
    };
  }, []);
}

// Hook to handle Ctrl+Option+Cmd+D for toggling dev section
function useDevSectionShortcut() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isImeKeyEvent(e)) return;
      if (e.ctrlKey && e.altKey && e.metaKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        useSettingsStore.getState().toggleDevSection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}

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
      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2
                 text-sm font-medium transition-colors
                 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]
                 data-[active=true]:bg-[var(--accent-bg)]
                 data-[active=true]:text-[var(--accent-primary)]"
    >
      {icon}
      {label}
    </button>
  );
}

// Navigation config icons — labels are resolved at render time via i18n
const navConfig = [
  { id: "appearance" as const, icon: Palette },
  { id: "editor" as const, icon: Type },
  { id: "files" as const, icon: FolderOpen },
  { id: "formats" as const, icon: Files },
  { id: "integrations" as const, icon: Plug },
  { id: "language" as const, icon: Languages },
  { id: "markdown" as const, icon: FileText },
  { id: "shortcuts" as const, icon: Keyboard },
  { id: "terminal" as const, icon: SquareTerminal },
  { id: "about" as const, icon: Info },
] as const;

// Valid section IDs for URL param validation
const validSections = new Set<string>([
  "about", "appearance", "editor", "files", "formats", "integrations", "language",
  "markdown", "shortcuts", "terminal", "advanced"
]);

function isValidSection(value: string): value is Section {
  return validSections.has(value);
}

export function SettingsPage() {
  const { t } = useTranslation("settings");
  const isMac = isMacPlatform();
  // Read initial section from URL query params
  const getInitialSection = (): Section => {
    const params = new URLSearchParams(window.location.search);
    const sectionParam = params.get("section");
    if (sectionParam && isValidSection(sectionParam)) {
      return sectionParam;
    }
    return "appearance";
  };

  const [section, setSection] = useState<Section>(getInitialSection);
  const showDevSection = useSettingsStore((state) => state.showDevSection);

  // Settings search (D2): a non-empty query stacks every searchable panel and
  // filters rows by label/description via SettingsSearchContext + CSS.
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const searching = normalizedQuery.length > 0;

  // Apply theme to this window
  useTheme();
  // Handle Cmd+W to close settings
  useSettingsClose();
  // Handle Cmd+Shift+D to toggle dev section
  useDevSectionShortcut();
  // Bidirectional sync with the main window's updateStore. Settings now
  // runs Check / Download locally (so the button stays responsive when
  // main is destroyed), so it must also broadcast its local state changes
  // back to main — otherwise main's StatusBar UpdateIndicator would stay
  // stale after a Settings-side check finds a new version.
  useUpdateBroadcast();
  useUpdateListener();

  // Listen for navigation events (e.g., from "Check for Updates" menu)
  useEffect(() => {
    const unlistenPromise = listen<string>("settings:navigate", (event) => {
      const targetSection = event.payload;
      if (isValidSection(targetSection)) {
        setSection(targetSection);
      }
    });

    return () => {
      safeUnlistenAsync(unlistenPromise);
    };
  }, []);

  // Switch to appearance when dev sections are hidden while viewing them.
  // Adjusted during render (converges immediately) rather than in an effect (#1063).
  if (!showDevSection && section === "advanced") {
    setSection("appearance");
  }

  const navItems = [
    ...navConfig
      .map((item) => ({
        id: item.id,
        icon: <item.icon className="w-4 h-4" />,
        label: t(`nav.${item.id}`),
      })),
    // Advanced section toggled via Ctrl+Option+Cmd+D
    ...(showDevSection
      ? [
          {
            id: "advanced" as const,
            icon: <Zap className="w-4 h-4" />,
            label: t("nav.advanced"),
          },
        ]
      : []),
  ];

  // Panels included in global search, from the shared registry. `advanced` is
  // appended only when the dev section is visible.
  const searchableIds: Section[] = showDevSection
    ? [...SEARCHABLE_PANEL_IDS, "advanced"]
    : SEARCHABLE_PANEL_IDS;
  const searchablePanels: SearchablePanel[] = searchableIds.map((id) => ({
    id,
    label: t(`nav.${id}`),
    Component: SETTINGS_PANELS[id],
  }));

  const ActivePanel = SETTINGS_PANELS[section];

  return (
    <div className="relative flex h-screen bg-[var(--bg-color)]">
      {/* Sidebar - full height */}
      <div
        className="w-52 shrink-0 border-r border-gray-200 dark:border-gray-700
                   bg-[var(--bg-secondary)] flex flex-col"
      >
        {isMac && <div data-tauri-drag-region className="h-12 shrink-0" />}
        {/* Search box */}
        <div className="px-3 pb-2">
          <SearchInput
            type="search"
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
          />
        </div>
        {/* Nav items */}
        <div className="flex-1 overflow-auto px-3 pb-3">
          <div className="space-y-1">
            {navItems.map((item) => (
              <NavItem
                key={item.id}
                icon={item.icon}
                label={item.label}
                active={!searching && section === item.id}
                onClick={() => {
                  setSearchQuery("");
                  setSection(item.id);
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col">
        {isMac && <div data-tauri-drag-region className="h-12 shrink-0" />}
        {/* Content */}
        <SettingsSearchContext.Provider value={normalizedQuery}>
          <div
            className="flex-1 overflow-auto p-6"
            data-settings-searching={searching ? "" : undefined}
          >
            {searching ? (
              <SettingsSearchResults panels={searchablePanels} query={normalizedQuery} />
            ) : (
              <ActivePanel />
            )}
          </div>
        </SettingsSearchContext.Provider>
      </div>

      {isMac && (
        <div
          data-tauri-drag-region
          className="absolute top-0 right-0 h-12 flex items-center justify-center pointer-events-none"
          style={{ left: "13rem" }}
        >
          <span className="text-sm font-medium text-[var(--text-color)]">
            {t("title")}
          </span>
        </div>
      )}
    </div>
  );
}
