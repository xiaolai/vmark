/**
 * Advanced Settings Section
 *
 * Developer and system configuration.
 */

import { useTranslation } from "react-i18next";
import { SettingRow, SettingsGroup, Toggle, TagInput } from "./components";
import { useSettingsStore } from "@/stores/settingsStore";
import { HotExitDevTools } from "./HotExitDevTools";
import { isMacPlatform } from "@/utils/shortcutMatch";

export function AdvancedSettings() {
  const { t } = useTranslation("settings");
  // Persisted (not ephemeral local state): once enabled, the experimental toggles
  // stay revealed across Settings re-opens and in release builds.
  const devTools = useSettingsStore((state) => state.advanced.developerMode);
  const customLinkProtocols = useSettingsStore((state) => state.advanced.customLinkProtocols);
  const keepBothEditorsAlive = useSettingsStore((state) => state.advanced.keepBothEditorsAlive);
  const workflowEngine = useSettingsStore((state) => state.advanced.workflowEngine);
  const workflowEditorPreserveYamlFormatting = useSettingsStore(
    (state) => state.advanced.workflowEditorPreserveYamlFormatting,
  );
  const clearMacQuarantineOnOpen = useSettingsStore(
    (state) => state.advanced.clearMacQuarantineOnOpen
  );
  const workflowFetchActionMetadata = useSettingsStore(
    (state) => state.advanced.workflowFetchActionMetadata
  );
  const workflowActionlint = useSettingsStore(
    (state) => state.advanced.workflowActionlint
  );
  const updateAdvancedSetting = useSettingsStore((state) => state.updateAdvancedSetting);
  const browserEnabled = useSettingsStore((state) => state.browser.enabled);
  const updateBrowserSetting = useSettingsStore((state) => state.updateBrowserSetting);
  const isMac = isMacPlatform();

  return (
    <div>
      <SettingsGroup title={t("advanced.group.developer")}>
        <SettingRow label={t("advanced.devTools.label")} description={t("advanced.devTools.description")}>
          <Toggle
            checked={devTools}
            onChange={(v) => updateAdvancedSetting("developerMode", v)}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t("advanced.group.linkProtocols")}>
        <div className="py-2.5">
          <div className="text-sm font-medium text-[var(--text-color)] mb-1">
            {t("advanced.customProtocols.label")}
          </div>
          <div className="text-xs text-[var(--text-tertiary)] mb-2">
            {t("advanced.customProtocols.hint")}
          </div>
          <TagInput
            value={customLinkProtocols ?? []}
            onChange={(v) => updateAdvancedSetting("customLinkProtocols", v)}
            placeholder={t("advanced.customProtocols.placeholder")}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("advanced.group.performance")}>
        <SettingRow
          label={t("advanced.keepBothEditors.label")}
          description={t("advanced.keepBothEditors.description")}
        >
          <Toggle
            checked={keepBothEditorsAlive}
            onChange={(v) => updateAdvancedSetting("keepBothEditorsAlive", v)}
          />
        </SettingRow>
      </SettingsGroup>

      {/* Workflow-file viewing/editing — these are the two toggles the
          website documents (audit 20260612 H28); not devtools-gated because
          the GHA viewer itself isn't. */}
      <SettingsGroup title={t("workflowEditor:settings.groupTitle")}>
        <SettingRow
          label={t("workflowEditor:settings.fetchActionMetadata.label")}
          description={t("workflowEditor:settings.fetchActionMetadata.description")}
        >
          <Toggle
            checked={workflowFetchActionMetadata}
            onChange={(v) => updateAdvancedSetting("workflowFetchActionMetadata", v)}
          />
        </SettingRow>
        <SettingRow
          label={t("workflowEditor:settings.actionlint.label")}
          description={t("workflowEditor:settings.actionlint.description")}
        >
          <Toggle
            checked={workflowActionlint}
            onChange={(v) => updateAdvancedSetting("workflowActionlint", v)}
          />
        </SettingRow>
      </SettingsGroup>

      {isMac && (
        <SettingsGroup title={t("advanced.group.macos")}>
          <SettingRow
            label={t("advanced.clearMacQuarantine.label")}
            description={t("advanced.clearMacQuarantine.description")}
          >
            <Toggle
              checked={clearMacQuarantineOnOpen}
              onChange={(v) => updateAdvancedSetting("clearMacQuarantineOnOpen", v)}
            />
          </SettingRow>
        </SettingsGroup>
      )}

      {/* Developer features - only visible when developer mode is enabled */}
      {devTools && (
        <SettingsGroup title={t("advanced.group.experimental")}>
          <SettingRow
            label={t("advanced.embeddedBrowser.label")}
            description={t("advanced.embeddedBrowser.description")}
          >
            <Toggle
              checked={browserEnabled}
              onChange={(v) => updateBrowserSetting("enabled", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("advanced.workflowEngine.label")}
            description={t("advanced.workflowEngine.description")}
          >
            <Toggle
              checked={workflowEngine}
              onChange={(v) => updateAdvancedSetting("workflowEngine", v)}
            />
          </SettingRow>
          {workflowEngine && (
            <SettingRow
              label={t("advanced.workflowEditorPreserveYamlFormatting.label")}
              description={t(
                "advanced.workflowEditorPreserveYamlFormatting.description",
              )}
            >
              <Toggle
                checked={workflowEditorPreserveYamlFormatting}
                onChange={(v) =>
                  updateAdvancedSetting(
                    "workflowEditorPreserveYamlFormatting",
                    v,
                  )
                }
              />
            </SettingRow>
          )}
        </SettingsGroup>
      )}

      {/* Hot Exit Dev Tools - only visible when developer mode is enabled */}
      {devTools && <HotExitDevTools />}
    </div>
  );
}
