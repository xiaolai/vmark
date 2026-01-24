/**
 * Settings Page
 *
 * Main settings window with navigation sidebar.
 * Sections sorted alphabetically.
 */

import { useState, useEffect } from "react";
import {
  Palette,
  Type,
  FolderOpen,
  Zap,
  Languages,
  FileText,
  FlaskConical,
  Keyboard,
  Plug,
  Terminal,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTheme } from "@/hooks/useTheme";
import { isImeKeyEvent } from "@/utils/imeGuard";

// Settings sections
import { AppearanceSettings } from "./settings/AppearanceSettings";
import { EditorSettings } from "./settings/EditorSettings";
import { FilesImagesSettings } from "./settings/FilesImagesSettings";
import { IntegrationsSettings } from "./settings/IntegrationsSettings";
import { LanguageSettings } from "./settings/LanguageSettings";
import { MarkdownSettings } from "./settings/MarkdownSettings";
import { ShortcutsSettings } from "./settings/ShortcutsSettings";
import { TerminalSettings } from "./settings/TerminalSettings";
import { AdvancedSettings } from "./settings/AdvancedSettings";
import { DevelopingSettings } from "./settings/DevelopingSettings";

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
      unlistenPromise.then((fn) => fn());
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

type Section =
  | "appearance"
  | "editor"
  | "files"
  | "integrations"
  | "language"
  | "markdown"
  | "shortcuts"
  | "terminal"
  | "advanced"
  | "developing";

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
                 data-[active=true]:text-[var(--accent-text)]"
    >
      {icon}
      {label}
    </button>
  );
}

// Advanced and Terminal sections only visible in dev mode
const showAdvancedSection = import.meta.env.DEV;
const showTerminalSection = import.meta.env.DEV;

// Navigation config - alphabetical order
const navConfig = [
  { id: "appearance" as const, icon: Palette, label: "Appearance" },
  { id: "editor" as const, icon: Type, label: "Editor" },
  { id: "files" as const, icon: FolderOpen, label: "Files & Images" },
  { id: "integrations" as const, icon: Plug, label: "Integrations" },
  { id: "language" as const, icon: Languages, label: "Language" },
  { id: "markdown" as const, icon: FileText, label: "Markdown" },
  { id: "shortcuts" as const, icon: Keyboard, label: "Shortcuts" },
  { id: "terminal" as const, icon: Terminal, label: "Terminal" },
  ...(showAdvancedSection ? [{ id: "advanced" as const, icon: Zap, label: "Advanced" }] : []),
] as const;

export function SettingsPage() {
  const [section, setSection] = useState<Section>("appearance");
  const showDevSection = useSettingsStore((state) => state.showDevSection);
  const terminalEnabled = useSettingsStore((state) => state.advanced.terminalEnabled);

  // Apply theme to this window
  useTheme();
  // Handle Cmd+W to close settings
  useSettingsClose();
  // Handle Cmd+Shift+D to toggle dev section
  useDevSectionShortcut();

  // Switch to appearance when dev section is hidden while viewing it
  useEffect(() => {
    if (!showDevSection && section === "developing") {
      setSection("appearance");
    }
  }, [showDevSection, section]);

  // Switch away from advanced when in production
  useEffect(() => {
    if (!showAdvancedSection && section === "advanced") {
      setSection("integrations");
    }
  }, [section]);

  // Terminal visible only in dev mode AND when enabled in settings
  const showTerminal = showTerminalSection && terminalEnabled;

  // Switch away from terminal when feature is disabled or in production
  useEffect(() => {
    if (!showTerminal && section === "terminal") {
      setSection("integrations");
    }
  }, [showTerminal, section]);

  const navItems = [
    ...navConfig
      .filter((item) => item.id !== "terminal" || showTerminal)
      .map((item) => ({
        id: item.id,
        icon: <item.icon className="w-4 h-4" />,
        label: item.label,
      })),
    ...(showDevSection
      ? [
          {
            id: "developing" as const,
            icon: <FlaskConical className="w-4 h-4" />,
            label: "Developing",
          },
        ]
      : []),
  ];

  return (
    <div className="relative flex h-screen bg-[var(--bg-primary)]">
      {/* Sidebar - full height */}
      <div
        className="w-52 shrink-0 border-r border-gray-200 dark:border-gray-700
                   bg-[var(--bg-secondary)] flex flex-col"
      >
        {/* Drag region for sidebar area */}
        <div data-tauri-drag-region className="h-12 shrink-0" />
        {/* Nav items */}
        <div className="flex-1 overflow-auto px-3 pb-3">
          <div className="space-y-1">
            {navItems.map((item) => (
              <NavItem
                key={item.id}
                icon={item.icon}
                label={item.label}
                active={section === item.id}
                onClick={() => setSection(item.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col">
        {/* Drag region for content area */}
        <div data-tauri-drag-region className="h-12 shrink-0" />
        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {section === "appearance" && <AppearanceSettings />}
          {section === "editor" && <EditorSettings />}
          {section === "files" && <FilesImagesSettings />}
          {section === "integrations" && <IntegrationsSettings />}
          {section === "language" && <LanguageSettings />}
          {section === "markdown" && <MarkdownSettings />}
          {section === "shortcuts" && <ShortcutsSettings />}
          {section === "terminal" && showTerminal && <TerminalSettings />}
          {section === "advanced" && <AdvancedSettings />}
          {section === "developing" && <DevelopingSettings />}
        </div>
      </div>

      {/* Centered title overlay */}
      <div
        data-tauri-drag-region
        className="absolute top-0 left-0 right-0 h-12 flex items-center justify-center pointer-events-none"
      >
        <span className="text-sm font-medium text-[var(--text-primary)]">
          Settings
        </span>
      </div>
    </div>
  );
}
