/**
 * Settings Page
 *
 * Main settings window with navigation sidebar.
 */

import { useState, useEffect } from "react";
import {
  Palette,
  Settings,
  FolderOpen,
  Zap,
  Languages,
  FileText,
  FlaskConical,
  Keyboard,
  Sparkles,
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
import { CJKFormattingSettings } from "./settings/CJKFormattingSettings";
import { MarkdownSettings } from "./settings/MarkdownSettings";
import { AiSettings } from "./settings/AiSettings";
import { ShortcutsSettings } from "./settings/ShortcutsSettings";
import { GeneralSettings } from "./settings/GeneralSettings";
import { FilesSettings } from "./settings/FilesSettings";
import { IntegrationsSettings } from "./settings/IntegrationsSettings";
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
  | "formatting"
  | "markdown"
  | "ai"
  | "shortcuts"
  | "general"
  | "files"
  | "integrations"
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

// Advanced section only visible in dev mode
const showAdvancedSection = import.meta.env.DEV;

const navConfig = [
  { id: "appearance" as const, icon: Palette, label: "Appearance" },
  { id: "formatting" as const, icon: Languages, label: "CJK Formatting" },
  { id: "markdown" as const, icon: FileText, label: "Markdown" },
  { id: "ai" as const, icon: Sparkles, label: "AI" },
  { id: "shortcuts" as const, icon: Keyboard, label: "Shortcuts" },
  { id: "general" as const, icon: Settings, label: "General" },
  { id: "files" as const, icon: FolderOpen, label: "Files" },
  { id: "integrations" as const, icon: Plug, label: "Integrations" },
  { id: "terminal" as const, icon: Terminal, label: "Terminal" },
  ...(showAdvancedSection ? [{ id: "advanced" as const, icon: Zap, label: "Advanced" }] : []),
] as const;

export function SettingsPage() {
  const [section, setSection] = useState<Section>("appearance");
  const showDevSection = useSettingsStore((state) => state.showDevSection);
  const commandMenuEnabled = useSettingsStore((state) => state.advanced.enableCommandMenu);
  const terminalEnabled = useSettingsStore((state) => state.advanced.terminalEnabled);

  // Apply theme to this window
  useTheme();
  // Handle Cmd+W to close settings
  useSettingsClose();
  // Handle Cmd+Shift+D to toggle dev section
  useDevSectionShortcut();

  // Switch to general when dev section is hidden while viewing it
  useEffect(() => {
    if (!showDevSection && section === "developing") {
      setSection("general");
    }
  }, [showDevSection, section]);

  // Switch away from advanced when in production
  useEffect(() => {
    if (!showAdvancedSection && section === "advanced") {
      setSection("integrations");
    }
  }, [section]);

  useEffect(() => {
    if (!commandMenuEnabled && section === "ai") {
      setSection("advanced");
    }
  }, [commandMenuEnabled, section]);

  // Switch away from terminal when feature is disabled
  useEffect(() => {
    if (!terminalEnabled && section === "terminal") {
      setSection("advanced");
    }
  }, [terminalEnabled, section]);

  const navItems = [
    ...navConfig
      .filter((item) => item.id !== "ai" || commandMenuEnabled)
      .filter((item) => item.id !== "terminal" || terminalEnabled)
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
          {section === "formatting" && <CJKFormattingSettings />}
          {section === "markdown" && <MarkdownSettings />}
          {section === "ai" && commandMenuEnabled && <AiSettings />}
          {section === "shortcuts" && <ShortcutsSettings />}
          {section === "general" && <GeneralSettings />}
          {section === "files" && <FilesSettings />}
          {section === "integrations" && <IntegrationsSettings />}
          {section === "terminal" && terminalEnabled && <TerminalSettings />}
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
