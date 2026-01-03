import { useState, useEffect } from "react";
import { Palette, Settings, FolderOpen, Zap, Languages, FileText, FlaskConical } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  useSettingsStore,
  themes,
  type ThemeId,
} from "@/stores/settingsStore";
import { useTheme } from "@/hooks/useTheme";
import { CJKFormattingSettings } from "./settings/CJKFormattingSettings";
import { MarkdownSettings } from "./settings/MarkdownSettings";
import { DevelopingSettings } from "./settings/DevelopingSettings";

// Hook to handle Cmd+W for settings window
function useSettingsClose() {
  useEffect(() => {
    const currentWindow = getCurrentWebviewWindow();

    const handleClose = async () => {
      const isFocused = await currentWindow.isFocused();
      if (isFocused) {
        await currentWindow.close();
      }
    };

    const unlistenPromise = listen("menu:close", handleClose);

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, []);
}

// Hook to handle Ctrl+Option+Cmd+D for toggling dev section
function useDevSectionShortcut() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.metaKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        useSettingsStore.getState().toggleDevSection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}

type Section = "appearance" | "formatting" | "markdown" | "general" | "files" | "advanced" | "developing";

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

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
      <div className="flex-1">
        <div className="text-sm font-medium text-[var(--text-primary)]">
          {label}
        </div>
        {description && (
          <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
            {description}
          </div>
        )}
      </div>
      <div className="ml-4">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-7 h-4 rounded-full transition-colors
                  ${checked ? "bg-[var(--accent-primary)]" : "bg-[var(--bg-tertiary)]"}`}
    >
      <span
        className={`absolute top-[3px] left-[3px] w-2.5 h-2.5 rounded-full bg-white shadow
                    transition-transform ${checked ? "translate-x-3" : ""}`}
      />
    </button>
  );
}

function GeneralSettings() {
  const general = useSettingsStore((state) => state.general);
  const updateSetting = useSettingsStore((state) => state.updateGeneralSetting);

  const selectClass = `px-2 py-1 rounded border border-gray-200 dark:border-gray-700
                       bg-[var(--bg-primary)] text-sm text-[var(--text-primary)]`;

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
        General
      </h2>

      {/* Auto-Save Section */}
      <div className="mb-6">
        <div className="text-sm font-medium text-[var(--text-primary)] mb-3">
          Auto-Save
        </div>
        <div className="space-y-1">
          <SettingRow
            label="Enable auto-save"
            description="Automatically save files when edited"
          >
            <Toggle
              checked={general.autoSaveEnabled}
              onChange={(v) => updateSetting("autoSaveEnabled", v)}
            />
          </SettingRow>
          <SettingRow
            label="Save interval"
            description="Time between auto-saves"
          >
            <select
              value={general.autoSaveInterval}
              onChange={(e) => updateSetting("autoSaveInterval", Number(e.target.value))}
              className={selectClass}
              disabled={!general.autoSaveEnabled}
            >
              <option value="10">10 seconds</option>
              <option value="30">30 seconds</option>
              <option value="60">1 minute</option>
              <option value="120">2 minutes</option>
              <option value="300">5 minutes</option>
            </select>
          </SettingRow>
        </div>
      </div>

      {/* Document History Section */}
      <div className="mb-6">
        <div className="text-sm font-medium text-[var(--text-primary)] mb-3">
          Document History
        </div>
        <div className="space-y-1">
          <SettingRow
            label="Keep document history"
            description="Track versions for undo and recovery"
          >
            <Toggle
              checked={general.historyEnabled}
              onChange={(v) => updateSetting("historyEnabled", v)}
            />
          </SettingRow>
          <SettingRow
            label="Maximum versions"
            description="Number of snapshots to keep"
          >
            <select
              value={general.historyMaxSnapshots}
              onChange={(e) => updateSetting("historyMaxSnapshots", Number(e.target.value))}
              className={selectClass}
              disabled={!general.historyEnabled}
            >
              <option value="10">10 versions</option>
              <option value="25">25 versions</option>
              <option value="50">50 versions</option>
              <option value="100">100 versions</option>
            </select>
          </SettingRow>
          <SettingRow
            label="Keep versions for"
            description="Maximum age of history"
          >
            <select
              value={general.historyMaxAgeDays}
              onChange={(e) => updateSetting("historyMaxAgeDays", Number(e.target.value))}
              className={selectClass}
              disabled={!general.historyEnabled}
            >
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
            </select>
          </SettingRow>
        </div>
      </div>
    </div>
  );
}

const themeLabels: Record<ThemeId, string> = {
  white: "White",
  paper: "Paper",
  mint: "Mint",
  sepia: "Sepia",
  night: "Night",
};

function AppearanceSettings() {
  const appearance = useSettingsStore((state) => state.appearance);
  const updateSetting = useSettingsStore(
    (state) => state.updateAppearanceSetting
  );

  const selectClass = `px-2 py-1 rounded border border-gray-200 dark:border-gray-700
                       bg-[var(--bg-primary)] text-sm text-[var(--text-primary)]`;

  return (
    <div>
      {/* Theme selector */}
      <div className="mb-6">
        <div className="text-sm font-medium text-[var(--text-primary)] mb-3">
          Theme
        </div>
        <div className="flex items-center gap-4">
          {(Object.keys(themes) as ThemeId[]).map((id) => (
            <button
              key={id}
              onClick={() => updateSetting("theme", id)}
              className="flex flex-col items-center gap-1.5"
            >
              <div
                className={`w-6 h-6 rounded-full transition-all ${
                  appearance.theme === id
                    ? "ring-1 ring-offset-2 ring-gray-400 dark:ring-gray-500"
                    : "hover:scale-110"
                }`}
                style={{
                  backgroundColor: themes[id].background,
                  border: `1px solid ${themes[id].border}`,
                }}
              />
              <span className={`text-xs ${
                appearance.theme === id
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)]"
              }`}>
                {themeLabels[id]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Typography */}
      <div className="text-sm font-medium text-[var(--text-primary)] mb-3">
        Typography
      </div>
      <div className="space-y-1">
        <SettingRow label="Latin Font">
          <select
            value={appearance.latinFont}
            onChange={(e) => updateSetting("latinFont", e.target.value)}
            className={selectClass}
          >
            <option value="system">System Default</option>
            <option value="athelas">Athelas</option>
            <option value="palatino">Palatino</option>
            <option value="georgia">Georgia</option>
            <option value="charter">Charter</option>
            <option value="literata">Literata</option>
          </select>
        </SettingRow>
        <SettingRow label="CJK Font">
          <select
            value={appearance.cjkFont}
            onChange={(e) => updateSetting("cjkFont", e.target.value)}
            className={selectClass}
          >
            <option value="system">System Default</option>
            <option value="pingfang">PingFang SC</option>
            <option value="songti">Songti SC</option>
            <option value="kaiti">Kaiti SC</option>
            <option value="notoserif">Noto Serif CJK</option>
            <option value="sourcehans">Source Han Sans</option>
          </select>
        </SettingRow>
        <SettingRow label="Mono Font">
          <select
            value={appearance.monoFont}
            onChange={(e) => updateSetting("monoFont", e.target.value)}
            className={selectClass}
          >
            <option value="system">System Default</option>
            <option value="firacode">Fira Code</option>
            <option value="jetbrains">JetBrains Mono</option>
            <option value="sourcecodepro">Source Code Pro</option>
            <option value="consolas">Consolas</option>
            <option value="inconsolata">Inconsolata</option>
          </select>
        </SettingRow>
        <SettingRow label="Font Size">
          <select
            value={appearance.fontSize}
            onChange={(e) => updateSetting("fontSize", Number(e.target.value))}
            className={selectClass}
          >
            <option value="14">14px</option>
            <option value="16">16px</option>
            <option value="18">18px</option>
            <option value="20">20px</option>
            <option value="22">22px</option>
          </select>
        </SettingRow>
        <SettingRow label="Line Height">
          <select
            value={appearance.lineHeight}
            onChange={(e) =>
              updateSetting("lineHeight", Number(e.target.value))
            }
            className={selectClass}
          >
            <option value="1.4">1.4 (Compact)</option>
            <option value="1.6">1.6 (Normal)</option>
            <option value="1.8">1.8 (Relaxed)</option>
            <option value="2.0">2.0 (Spacious)</option>
          </select>
        </SettingRow>
        <SettingRow label="Paragraph Spacing">
          <select
            value={appearance.paragraphSpacing}
            onChange={(e) =>
              updateSetting("paragraphSpacing", Number(e.target.value))
            }
            className={selectClass}
          >
            <option value="0.5">0.5em (Tight)</option>
            <option value="1">1em (Normal)</option>
            <option value="1.5">1.5em (Relaxed)</option>
            <option value="2">2em (Spacious)</option>
          </select>
        </SettingRow>
      </div>
    </div>
  );
}

function FilesSettings() {
  const [defaultDir, setDefaultDir] = useState("~/Documents");
  const [createBackups, setCreateBackups] = useState(true);

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
        Files
      </h2>
      <div className="space-y-1">
        <SettingRow
          label="Default directory"
          description="Where new files are saved"
        >
          <input
            type="text"
            value={defaultDir}
            onChange={(e) => setDefaultDir(e.target.value)}
            className="w-48 px-2 py-1 rounded border border-gray-200 dark:border-gray-700
                       bg-[var(--bg-primary)] text-sm text-[var(--text-primary)]"
          />
        </SettingRow>
        <SettingRow
          label="Create backups"
          description="Save backup copies of files"
        >
          <Toggle checked={createBackups} onChange={setCreateBackups} />
        </SettingRow>
      </div>
    </div>
  );
}

function AdvancedSettings() {
  const [devTools, setDevTools] = useState(false);
  const [hardwareAccel, setHardwareAccel] = useState(true);

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
        Advanced
      </h2>
      <div className="space-y-1">
        <SettingRow label="Developer tools" description="Enable developer mode">
          <Toggle checked={devTools} onChange={setDevTools} />
        </SettingRow>
        <SettingRow
          label="Hardware acceleration"
          description="Use GPU for rendering"
        >
          <Toggle checked={hardwareAccel} onChange={setHardwareAccel} />
        </SettingRow>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const [section, setSection] = useState<Section>("appearance");
  const showDevSection = useSettingsStore((state) => state.showDevSection);

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

  const navItems = [
    { id: "appearance" as const, icon: <Palette className="w-4 h-4" />, label: "Appearance" },
    { id: "formatting" as const, icon: <Languages className="w-4 h-4" />, label: "CJK Formatting" },
    { id: "markdown" as const, icon: <FileText className="w-4 h-4" />, label: "Markdown" },
    { id: "general" as const, icon: <Settings className="w-4 h-4" />, label: "General" },
    { id: "files" as const, icon: <FolderOpen className="w-4 h-4" />, label: "Files" },
    { id: "advanced" as const, icon: <Zap className="w-4 h-4" />, label: "Advanced" },
    ...(showDevSection ? [{ id: "developing" as const, icon: <FlaskConical className="w-4 h-4" />, label: "Developing" }] : []),
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
          {section === "general" && <GeneralSettings />}
          {section === "files" && <FilesSettings />}
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
