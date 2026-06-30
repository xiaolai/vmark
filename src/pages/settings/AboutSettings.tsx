/**
 * About Settings Section
 *
 * Shows app info (version, links) and update status.
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SettingRow, SettingsGroup, Button, Toggle, Select } from "./components";
import type { UpdateCheckFrequency } from "@/stores/settingsTypes";
import { useMcpStore } from "@/stores/mcpStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUpdateOperations } from "@/hooks/useUpdateOperations";
import { Loader2, CheckCircle2, AlertCircle, Download, Globe } from "lucide-react";
import { GithubMark } from "./GithubMark";
import { UpdateAvailableCard } from "./UpdateAvailableCard";
import appIcon from "@/assets/app-icon.png";

const WEBSITE_URL = "https://vmark.app";
const GITHUB_URL = "https://github.com/xiaolai/vmark";

function VersionInfo() {
  const { t } = useTranslation(["settings", "common"]);
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(t("common:unknown")));
  }, [t]);

  return (
    <div className="flex items-center gap-3">
      <img src={appIcon} alt="VMark" className="w-12 h-12" />
      <div>
        <div className="text-lg font-semibold text-[var(--text-color)]">VMark</div>
        <div className="text-sm text-[var(--text-secondary)]">{t("about.version", { version })}</div>
      </div>
    </div>
  );
}

function Links() {
  const { t } = useTranslation("settings");
  const links = [
    { icon: Globe, label: t("about.website"), url: WEBSITE_URL },
    { icon: GithubMark, label: t("about.github"), url: GITHUB_URL },
  ];

  return (
    <ul className="space-y-0.5 pt-0.5">
      {links.map(({ icon: Icon, label, url }) => (
        <li key={label}>
          <button
            onClick={() => openUrl(url)}
            className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--primary-color)] transition-colors"
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        </li>
      ))}
    </ul>
  );
}

function StatusIndicator() {
  const { t } = useTranslation("settings");
  const status = useMcpStore((state) => state.update.status);
  const updateInfo = useMcpStore((state) => state.update.updateInfo);
  const error = useMcpStore((state) => state.update.error);

  if (status === "checking") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
        <Loader2 className="w-3 h-3 animate-spin" />
        {t("about.updateStatus.checking")}
      </span>
    );
  }

  if (status === "up-to-date") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
        <CheckCircle2 className="w-3 h-3 text-[var(--success-color)]" />
        {t("about.updateStatus.upToDate")}
      </span>
    );
  }

  if (status === "available" && updateInfo) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--primary-color)]">
        <Download className="w-3 h-3" />
        {t("about.updateStatus.available", { version: updateInfo.version })}
      </span>
    );
  }

  if (status === "downloading" || status === "installing") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
        <Loader2 className="w-3 h-3 animate-spin" />
        {status === "installing"
          ? t("about.updateStatus.installing")
          : t("about.updateStatus.downloading")}
      </span>
    );
  }

  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--success-color)]">
        <CheckCircle2 className="w-3 h-3" />
        {t("about.updateStatus.ready")}
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--error-color)]">
        <AlertCircle className="w-3 h-3" />
        {error || t("about.updateStatus.checkFailed")}
      </span>
    );
  }

  return null;
}

export function AboutSettings() {
  const { t } = useTranslation("settings");
  const status = useMcpStore((state) => state.update.status);
  const autoCheckEnabled = useSettingsStore((state) => state.update.autoCheckEnabled);
  const checkFrequency = useSettingsStore((state) => state.update.checkFrequency);
  const autoDownload = useSettingsStore((state) => state.update.autoDownload);
  const updateUpdateSetting = useSettingsStore((state) => state.updateUpdateSetting);
  const resetSettings = useSettingsStore((state) => state.resetSettings);
  const { checkForUpdates } = useUpdateOperations();
  const [isChecking, setIsChecking] = useState(false);

  const handleCheckNow = async () => {
    setIsChecking(true);
    try {
      await checkForUpdates();
    } finally {
      setIsChecking(false);
    }
  };

  // Disable check button during active operations
  const checkDisabled =
    isChecking ||
    status === "checking" ||
    status === "downloading" ||
    status === "installing" ||
    status === "ready";

  return (
    <div>
      {/* App info */}
      <SettingsGroup title="">
        <div className="py-2 flex items-start justify-between">
          <VersionInfo />
          <Links />
        </div>
      </SettingsGroup>

      {/* Update available/downloading/ready card */}
      <UpdateAvailableCard />

      {/* Check for updates */}
      <SettingsGroup title={t("about.group.updates")}>
        <SettingRow
          label={t("about.autoUpdates.label")}
          description={t("about.autoUpdates.description")}
        >
          <Toggle
            checked={autoCheckEnabled}
            onChange={(v) => updateUpdateSetting("autoCheckEnabled", v)}
          />
        </SettingRow>
        <SettingRow
          label={t("about.checkFrequency.label")}
          description={t("about.checkFrequency.description")}
          disabled={!autoCheckEnabled}
        >
          <Select<UpdateCheckFrequency>
            value={checkFrequency}
            options={[
              { value: "startup", label: t("about.checkFrequency.startup") },
              { value: "daily", label: t("about.checkFrequency.daily") },
              { value: "weekly", label: t("about.checkFrequency.weekly") },
              { value: "manual", label: t("about.checkFrequency.manual") },
            ]}
            onChange={(v) => updateUpdateSetting("checkFrequency", v)}
            disabled={!autoCheckEnabled}
          />
        </SettingRow>
        <SettingRow
          label={t("about.autoDownload.label")}
          description={t("about.autoDownload.description")}
        >
          <Toggle
            checked={autoDownload}
            onChange={(v) => updateUpdateSetting("autoDownload", v)}
          />
        </SettingRow>
        <SettingRow label={t("about.checkForUpdates.label")}>
          <div className="flex items-center gap-3">
            <StatusIndicator />
            <Button
              variant="tertiary"
              onClick={handleCheckNow}
              disabled={checkDisabled}
            >
              {isChecking || status === "checking" ? t("about.checking") : t("about.checkNow")}
            </Button>
          </div>
        </SettingRow>
      </SettingsGroup>

      {/* Reset all settings to defaults (D3) */}
      <SettingsGroup title={t("about.group.reset")}>
        <SettingRow
          label={t("about.resetSettings.label")}
          description={t("about.resetSettings.description")}
        >
          <Button
            variant="danger"
            onClick={() => {
              if (confirm(t("about.resetSettings.confirm"))) {
                resetSettings();
              }
            }}
          >
            {t("about.resetSettings.button")}
          </Button>
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
