/**
 * Files & Images Settings Section
 *
 * File browser, auto-save, document history, and image configuration.
 */

import { SettingRow, SettingsGroup, Toggle, Select } from "./components";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore, type ImageAutoResizeOption } from "@/stores/settingsStore";
import { updateWorkspaceConfig } from "@/hooks/workspaceConfig";

const autoResizeOptions: { value: string; label: string }[] = [
  { value: "0", label: "Off" },
  { value: "800", label: "800px" },
  { value: "1200", label: "1200px" },
  { value: "1920", label: "1920px (Full HD)" },
  { value: "2560", label: "2560px (2K)" },
];

export function FilesImagesSettings() {
  const isWorkspaceMode = useWorkspaceStore((state) => state.isWorkspaceMode);
  const showHiddenFiles = useWorkspaceStore(
    (state) => state.config?.showHiddenFiles ?? false
  );

  const general = useSettingsStore((state) => state.general);
  const updateGeneralSetting = useSettingsStore((state) => state.updateGeneralSetting);

  const autoResizeMax = useSettingsStore((state) => state.image.autoResizeMax);
  const copyToAssets = useSettingsStore((state) => state.image.copyToAssets);
  const cleanupOrphansOnClose = useSettingsStore((state) => state.image.cleanupOrphansOnClose);
  const updateImageSetting = useSettingsStore((state) => state.updateImageSetting);

  return (
    <div>
      {/* File Browser */}
      <SettingsGroup title="File Browser">
        <SettingRow
          label="Show hidden files"
          description="Include dotfiles and hidden system items in the file explorer"
          disabled={!isWorkspaceMode}
        >
          <Toggle
            checked={showHiddenFiles}
            onChange={(value) => {
              void updateWorkspaceConfig({ showHiddenFiles: value });
            }}
            disabled={!isWorkspaceMode}
          />
        </SettingRow>
      </SettingsGroup>

      {/* Saving */}
      <SettingsGroup title="Saving">
        <SettingRow
          label="Enable auto-save"
          description="Automatically save files when edited"
        >
          <Toggle
            checked={general.autoSaveEnabled}
            onChange={(v) => updateGeneralSetting("autoSaveEnabled", v)}
          />
        </SettingRow>
        <SettingRow
          label="Save interval"
          description="Time between auto-saves"
          disabled={!general.autoSaveEnabled}
        >
          <Select
            value={String(general.autoSaveInterval)}
            options={[
              { value: "10", label: "10 seconds" },
              { value: "30", label: "30 seconds" },
              { value: "60", label: "1 minute" },
              { value: "120", label: "2 minutes" },
              { value: "300", label: "5 minutes" },
            ]}
            onChange={(v) => updateGeneralSetting("autoSaveInterval", Number(v))}
            disabled={!general.autoSaveEnabled}
          />
        </SettingRow>
        <SettingRow
          label="Keep document history"
          description="Track versions for undo and recovery"
        >
          <Toggle
            checked={general.historyEnabled}
            onChange={(v) => updateGeneralSetting("historyEnabled", v)}
          />
        </SettingRow>
        <SettingRow
          label="Maximum versions"
          description="Number of snapshots to keep"
          disabled={!general.historyEnabled}
        >
          <Select
            value={String(general.historyMaxSnapshots)}
            options={[
              { value: "10", label: "10 versions" },
              { value: "25", label: "25 versions" },
              { value: "50", label: "50 versions" },
              { value: "100", label: "100 versions" },
            ]}
            onChange={(v) => updateGeneralSetting("historyMaxSnapshots", Number(v))}
            disabled={!general.historyEnabled}
          />
        </SettingRow>
        <SettingRow
          label="Keep versions for"
          description="Maximum age of history"
          disabled={!general.historyEnabled}
        >
          <Select
            value={String(general.historyMaxAgeDays)}
            options={[
              { value: "1", label: "1 day" },
              { value: "7", label: "7 days" },
              { value: "14", label: "14 days" },
              { value: "30", label: "30 days" },
            ]}
            onChange={(v) => updateGeneralSetting("historyMaxAgeDays", Number(v))}
            disabled={!general.historyEnabled}
          />
        </SettingRow>
      </SettingsGroup>

      {/* Images */}
      <SettingsGroup title="Images">
        <SettingRow
          label="Auto-resize on paste"
          description="Automatically resize large images before saving to assets"
        >
          <Select
            value={String(autoResizeMax)}
            options={autoResizeOptions}
            onChange={(v) =>
              updateImageSetting(
                "autoResizeMax",
                Number(v) as ImageAutoResizeOption
              )
            }
          />
        </SettingRow>
        <SettingRow
          label="Copy to assets folder"
          description="Copy pasted/dropped images to the document's assets folder"
        >
          <Toggle
            checked={copyToAssets}
            onChange={(value) => updateImageSetting("copyToAssets", value)}
          />
        </SettingRow>
        <SettingRow
          label="Clean up unused images on close"
          description="Automatically delete images from assets folder that are no longer referenced in the document"
        >
          <Toggle
            checked={cleanupOrphansOnClose}
            onChange={(value) => updateImageSetting("cleanupOrphansOnClose", value)}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
