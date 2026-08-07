/**
 * Files & Images Settings Section
 *
 * File browser, auto-save, document history, image configuration,
 * and document export tools (Pandoc).
 *
 * Maintenance boundary: Saving/History and Images remain inline intentionally;
 * extract the affected group into a sibling component before its next
 * behaviour change. The File Browser group was extracted first because its
 * rows were under active change and a focused test of them was mounting this
 * whole panel — and with it DocumentToolsSettings' `detect_pandoc` probe.
 * Settled with Codex (thread 019fdb16) rather than deferred on line count:
 * 300 lines is a tripwire, not a design target.
 */

import { useTranslation } from "react-i18next";
import { SettingRow, SettingsGroup, Toggle, Select } from "./components";
import { useSettingsStore, type ImageAutoResizeOption } from "@/stores/settingsStore";
import { WorkspaceSettingsGroup } from "./WorkspaceSettingsGroup";
import { FileBrowserSettingsGroup } from "./FileBrowserSettingsGroup";
import { DocumentToolsSettings } from "./DocumentToolsSettings";

export function FilesImagesSettings() {
  const { t } = useTranslation("settings");
  const general = useSettingsStore((state) => state.general);
  const updateGeneralSetting = useSettingsStore((state) => state.updateGeneralSetting);

  const autoResizeMax = useSettingsStore((state) => state.image.autoResizeMax);
  const copyToAssets = useSettingsStore((state) => state.image.copyToAssets);
  const cleanupOrphansOnClose = useSettingsStore((state) => state.image.cleanupOrphansOnClose);
  const updateImageSetting = useSettingsStore((state) => state.updateImageSetting);

  const isMac = navigator.platform.includes("Mac");

  const autoResizeOptions: { value: string; label: string }[] = [
    { value: "0", label: t("files.autoResize.off") },
    { value: "800", label: t("files.autoResize.800") },
    { value: "1200", label: t("files.autoResize.1200") },
    { value: "1920", label: t("files.autoResize.1920") },
    { value: "2560", label: t("files.autoResize.2560") },
  ];

  return (
    <div>
      <WorkspaceSettingsGroup />
      <FileBrowserSettingsGroup />

      <SettingsGroup title={t("files.group.quitBehavior")}>
        <SettingRow
          label={t("files.confirmQuit.label")}
          description={isMac ? t("files.confirmQuit.descriptionMac") : t("files.confirmQuit.descriptionOther")}
        >
          <Toggle
            checked={general.confirmQuit}
            onChange={(v) => updateGeneralSetting("confirmQuit", v)}
          />
        </SettingRow>
      </SettingsGroup>

      {/* Saving */}
      <SettingsGroup title={t("files.group.saving")}>
        <SettingRow
          label={t("files.autoSave.label")}
          description={t("files.autoSave.description")}
        >
          <Toggle
            checked={general.autoSaveEnabled}
            onChange={(v) => updateGeneralSetting("autoSaveEnabled", v)}
          />
        </SettingRow>
        {/* Provenance tracking is opt-in because turning it on lets VMark
            REWRITE the document to insert a `vmark:` identity block. It sits
            here, next to autosave, because autosave is what made the rewrite
            invisible. */}
        <SettingRow
          label={t("files.coherenceCapture.label")}
          description={t("files.coherenceCapture.description")}
        >
          <Toggle
            checked={general.coherenceCaptureOnSave}
            onChange={(v) => updateGeneralSetting("coherenceCaptureOnSave", v)}
          />
        </SettingRow>
        <SettingRow
          label={t("files.saveInterval.label")}
          description={t("files.saveInterval.description")}
          disabled={!general.autoSaveEnabled}
        >
          <Select
            value={String(general.autoSaveInterval)}
            options={[
              { value: "10", label: t("files.saveInterval.10s") },
              { value: "30", label: t("files.saveInterval.30s") },
              { value: "60", label: t("files.saveInterval.1m") },
              { value: "120", label: t("files.saveInterval.2m") },
              { value: "300", label: t("files.saveInterval.5m") },
            ]}
            onChange={(v) => updateGeneralSetting("autoSaveInterval", Number(v))}
            disabled={!general.autoSaveEnabled}
          />
        </SettingRow>
        <SettingRow
          label={t("files.keepHistory.label")}
          description={t("files.keepHistory.description")}
        >
          <Toggle
            checked={general.historyEnabled}
            onChange={(v) => updateGeneralSetting("historyEnabled", v)}
          />
        </SettingRow>
        <SettingRow
          label={t("files.maxVersions.label")}
          description={t("files.maxVersions.description")}
          disabled={!general.historyEnabled}
        >
          <Select
            value={String(general.historyMaxSnapshots)}
            options={[
              { value: "10", label: t("files.maxVersions.10") },
              { value: "25", label: t("files.maxVersions.25") },
              { value: "50", label: t("files.maxVersions.50") },
              { value: "100", label: t("files.maxVersions.100") },
            ]}
            onChange={(v) => updateGeneralSetting("historyMaxSnapshots", Number(v))}
            disabled={!general.historyEnabled}
          />
        </SettingRow>
        <SettingRow
          label={t("files.keepVersionsFor.label")}
          description={t("files.keepVersionsFor.description")}
          disabled={!general.historyEnabled}
        >
          <Select
            value={String(general.historyMaxAgeDays)}
            options={[
              { value: "1", label: t("files.keepVersionsFor.1d") },
              { value: "7", label: t("files.keepVersionsFor.7d") },
              { value: "14", label: t("files.keepVersionsFor.14d") },
              { value: "30", label: t("files.keepVersionsFor.30d") },
            ]}
            onChange={(v) => updateGeneralSetting("historyMaxAgeDays", Number(v))}
            disabled={!general.historyEnabled}
          />
        </SettingRow>
        <SettingRow
          label={t("files.mergeWindow.label")}
          description={t("files.mergeWindow.description")}
          disabled={!general.historyEnabled}
        >
          <Select
            value={String(general.historyMergeWindow)}
            options={[
              { value: "0", label: t("files.mergeWindow.off") },
              { value: "10", label: t("files.mergeWindow.10s") },
              { value: "30", label: t("files.mergeWindow.30s") },
              { value: "60", label: t("files.mergeWindow.1m") },
              { value: "120", label: t("files.mergeWindow.2m") },
            ]}
            onChange={(v) => updateGeneralSetting("historyMergeWindow", Number(v))}
            disabled={!general.historyEnabled}
          />
        </SettingRow>
        <SettingRow
          label={t("files.maxFileSize.label")}
          description={t("files.maxFileSize.description")}
          disabled={!general.historyEnabled}
        >
          <Select
            value={String(general.historyMaxFileSize)}
            options={[
              { value: "256", label: t("files.maxFileSize.256kb") },
              { value: "512", label: t("files.maxFileSize.512kb") },
              { value: "1024", label: t("files.maxFileSize.1mb") },
              { value: "5120", label: t("files.maxFileSize.5mb") },
              { value: "0", label: t("files.maxFileSize.unlimited") },
            ]}
            onChange={(v) => updateGeneralSetting("historyMaxFileSize", Number(v))}
            disabled={!general.historyEnabled}
          />
        </SettingRow>
      </SettingsGroup>

      {/* Images */}
      <SettingsGroup title={t("files.group.images")}>
        <SettingRow
          label={t("files.autoResize.label")}
          description={t("files.autoResize.description")}
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
          label={t("files.copyToAssets.label")}
          description={t("files.copyToAssets.description")}
        >
          <Toggle
            checked={copyToAssets}
            onChange={(value) => updateImageSetting("copyToAssets", value)}
          />
        </SettingRow>
        <SettingRow
          label={t("files.cleanupOrphans.label")}
          description={t("files.cleanupOrphans.description")}
        >
          <Toggle
            checked={cleanupOrphansOnClose}
            onChange={(value) => updateImageSetting("cleanupOrphansOnClose", value)}
          />
        </SettingRow>
      </SettingsGroup>

      {/* Document Tools */}
      <DocumentToolsSettings />
    </div>
  );
}
