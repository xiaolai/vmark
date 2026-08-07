/**
 * Advanced Settings Section
 *
 * Developer and system configuration.
 */

import { useTranslation } from "react-i18next";
import { SettingRow, SettingsGroup, Toggle, TagInput, Select } from "./components";
import { useSettingsStore } from "@/stores/settingsStore";
import { HotExitDevTools } from "./HotExitDevTools";
import { CoherenceSettingsGroup } from "./CoherenceSettingsGroup";
import { isMacPlatform } from "@/utils/shortcutMatch";

export function AdvancedSettings() {
  const { t } = useTranslation("settings");
  // Persisted (not ephemeral local state): once enabled, the experimental toggles
  // stay revealed across Settings re-opens and in release builds.
  const devTools = useSettingsStore((state) => state.advanced.developerMode);
  const customLinkProtocols = useSettingsStore((state) => state.advanced.customLinkProtocols);
  const keepBothEditorsAlive = useSettingsStore((state) => state.advanced.keepBothEditorsAlive);
  const workflowViewer = useSettingsStore((state) => state.advanced.workflowViewer);
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
  const browserAiSession = useSettingsStore((state) => state.browser.aiSession);
  const browserAiAllowLoopback = useSettingsStore((state) => state.browser.aiAllowLoopback);
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

      <CoherenceSettingsGroup />

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
          {/* The embedded browser and its two AI settings are ONE group with ONE
              gate. They used to disagree: posture and loopback sat here in plain
              sight while the toggle that makes them mean anything was behind
              `devTools`, so a user could configure a feature they had no way to
              switch on — and the website documents it as "an early, OPT-IN
              feature", which a developer-only toggle makes untrue. The dependents
              are revealed by the gate, matching `workflowEngine` below. */}
          <SettingRow
            label={t("advanced.embeddedBrowser.label")}
            description={t("advanced.embeddedBrowser.description")}
          >
            <Toggle
              checked={browserEnabled}
              onChange={(v) => updateBrowserSetting("enabled", v)}
            />
          </SettingRow>
          {/* Site permissions are NOT here. Settings opens as a separate Tauri window
              with its own JS context, so it has its own Zustand store: a grants list
              rendered here reads an empty array and its Revoke button mutates a store
              the document window never sees. It told you that you had revoked, and you
              had not. They live in the browser sidebar instead, in the window that owns
              them. (Audit finding, High.) */}
          {browserEnabled && (
            <>
              <SettingRow
                label={t("advanced.browserAiSession.label")}
                description={t("advanced.browserAiSession.description")}
              >
                <Select
                  value={browserAiSession}
                  options={[
                    { value: "sandbox", label: t("advanced.browserAiSession.sandbox") },
                    { value: "shared", label: t("advanced.browserAiSession.shared") },
                  ]}
                  onChange={(value) => updateBrowserSetting("aiSession", value)}
                />
              </SettingRow>
              <SettingRow
                label={t("advanced.browserAiAllowLoopback.label")}
                description={t("advanced.browserAiAllowLoopback.description")}
              >
                <Toggle
                  checked={browserAiAllowLoopback}
                  onChange={(value) => updateBrowserSetting("aiAllowLoopback", value)}
                />
              </SettingRow>
            </>
          )}
        </SettingsGroup>
      )}

      {/* Developer features - only visible when developer mode is enabled */}
      {devTools && (
        <SettingsGroup title={t("advanced.group.experimental")}>
          {/* Two switches, not one (WI-19). The viewer is read-only GitHub
              Actions authoring help; the engine executes YAML — it spawns AI
              providers, writes files, and takes snapshots. One flag for both
              meant wanting completion required arming the runner, and the
              runner's Rust commands ignored the flag entirely. */}
          <SettingRow
            label={t("advanced.workflowViewer.label")}
            description={t("advanced.workflowViewer.description")}
          >
            <Toggle
              checked={workflowViewer}
              onChange={(v) => updateAdvancedSetting("workflowViewer", v)}
            />
          </SettingRow>
          {/* A viewer dependent: it governs how the structured GitHub Actions
              editor writes YAML back. Hanging it off the engine flag is what
              made it unreachable for a viewer-only user. */}
          {workflowViewer && (
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
          <SettingRow
            label={t("advanced.workflowEngine.label")}
            description={t("advanced.workflowEngine.description")}
          >
            <Toggle
              checked={workflowEngine}
              onChange={(v) => updateAdvancedSetting("workflowEngine", v)}
            />
          </SettingRow>
        </SettingsGroup>
      )}

      {/* Hot Exit Dev Tools - only visible when developer mode is enabled */}
      {devTools && <HotExitDevTools />}
    </div>
  );
}
