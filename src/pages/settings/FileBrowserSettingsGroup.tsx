/**
 * File Browser settings group.
 *
 * Purpose: the three rows that decide what the file explorer LISTS and how it
 * spells what it lists — hidden files, non-markdown files, and extensions.
 *
 * Extracted from FilesImagesSettings (#1224 follow-up) at a complete domain
 * seam, joining WorkspaceSettingsGroup and DocumentToolsSettings as siblings.
 * The reason is testability, not line count: a focused test of these rows used
 * to render the whole panel, which mounts DocumentToolsSettings and therefore
 * fires a `detect_pandoc` Tauri probe. A three-row assertion should not depend
 * on Pandoc detection and a permissive global mock.
 *
 * Key decisions:
 *   - The first two rows are WORKSPACE-scoped and disable themselves without
 *     one, because `updateWorkspaceConfig` is a no-op there. The third is
 *     global: it also labels the tab strip and title bar, which exist with no
 *     folder open.
 *
 * @coordinates-with FilesImagesSettings.tsx — mounts this group
 * @coordinates-with services/workspaces/workspaceConfig.ts — persists the two workspace rows
 * @module pages/settings/FileBrowserSettingsGroup
 */
import { useTranslation } from "react-i18next";
import { SettingRow, SettingsGroup, Toggle } from "./components";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { updateWorkspaceConfig } from "@/services/workspaces/workspaceConfig";

/** Visibility settings for the file explorer sidebar. */
export function FileBrowserSettingsGroup() {
  const { t } = useTranslation("settings");
  const isWorkspaceMode = useWorkspaceStore((state) => state.isWorkspaceMode);
  const showHiddenFiles = useWorkspaceStore(
    (state) => state.config?.showHiddenFiles ?? false
  );
  const showAllFiles = useWorkspaceStore(
    (state) => state.config?.showAllFiles ?? false
  );
  const showFileExtensions = useSettingsStore(
    (state) => state.general.showFileExtensions ?? true
  );
  const updateGeneralSetting = useSettingsStore((state) => state.updateGeneralSetting);

  return (
    <SettingsGroup title={t("files.group.fileBrowser")}>
      <SettingRow
        label={t("files.showHiddenFiles.label")}
        description={t("files.showHiddenFiles.description")}
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
      <SettingRow
        label={t("files.showAllFiles.label")}
        description={t("files.showAllFiles.description")}
        disabled={!isWorkspaceMode}
      >
        <Toggle
          checked={showAllFiles}
          onChange={(value) => {
            void updateWorkspaceConfig({ showAllFiles: value });
          }}
          disabled={!isWorkspaceMode}
        />
      </SettingRow>
      {/* Not workspace-scoped, unlike the two above: the same preference also
          labels the tab strip and title bar, which exist without a workspace. */}
      <SettingRow
        label={t("files.showFileExtensions.label")}
        description={t("files.showFileExtensions.description")}
      >
        <Toggle
          checked={showFileExtensions}
          onChange={(value) => updateGeneralSetting("showFileExtensions", value)}
        />
      </SettingRow>
    </SettingsGroup>
  );
}
