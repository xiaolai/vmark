import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import { SettingRow, SettingsGroup, Toggle } from "./components";

export function WorkspaceSettingsGroup() {
  const { t } = useTranslation("settings");
  const workspaceRailMode = useSettingsStore((state) => state.general.workspaceRailMode);
  const updateGeneralSetting = useSettingsStore((state) => state.updateGeneralSetting);

  return (
    <SettingsGroup title={t("files.group.workspace")}>
      <SettingRow
        label={t("files.workspaceRailMode.label")}
        description={t("files.workspaceRailMode.description")}
      >
        <Toggle
          checked={workspaceRailMode}
          onChange={(v) => updateGeneralSetting("workspaceRailMode", v)}
        />
      </SettingRow>
    </SettingsGroup>
  );
}
