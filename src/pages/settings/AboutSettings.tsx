/**
 * About Settings Section
 *
 * Shows app info (version, links) and update status.
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { SettingRow, SettingsGroup, Button, Toggle } from "./components";
import { useUpdateStore } from "@/stores/updateStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUpdateOperations } from "@/hooks/useUpdateOperations";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Download,
  RefreshCw,
  SkipForward,
  Globe,
  Github,
} from "lucide-react";
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
        <div className="text-lg font-semibold text-[var(--text-primary)]">VMark</div>
        <div className="text-sm text-[var(--text-secondary)]">{t("about.version", { version })}</div>
      </div>
    </div>
  );
}

function Links() {
  const { t } = useTranslation("settings");
  const links = [
    { icon: Globe, label: t("about.website"), url: WEBSITE_URL },
    { icon: Github, label: t("about.github"), url: GITHUB_URL },
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
  const status = useUpdateStore((state) => state.status);
  const updateInfo = useUpdateStore((state) => state.updateInfo);
  const error = useUpdateStore((state) => state.error);

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

  if (status === "downloading") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
        <Loader2 className="w-3 h-3 animate-spin" />
        {t("about.updateStatus.downloading")}
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

function DownloadProgress() {
  const { t } = useTranslation("settings");
  const downloadProgress = useUpdateStore((state) => state.downloadProgress);

  if (!downloadProgress) return null;

  const { downloaded, total } = downloadProgress;
  const percentage = total ? Math.round((downloaded / total) * 100) : 0;
  const downloadedMB = (downloaded / 1024 / 1024).toFixed(1);
  const totalMB = total ? (total / 1024 / 1024).toFixed(1) : "?";

  return (
    <div className="mt-2 space-y-1">
      <div className="flex justify-between text-xs text-[var(--text-tertiary)]">
        <span>{t("about.downloadProgress.label")}</span>
        <span>
          {downloadedMB} / {totalMB} MB ({percentage}%)
        </span>
      </div>
      <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
        <div
          className="h-full bg-[var(--primary-color)] transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function UpdateAvailableCard() {
  const { t } = useTranslation("settings");
  const status = useUpdateStore((state) => state.status);
  const updateInfo = useUpdateStore((state) => state.updateInfo);
  const dismissed = useUpdateStore((state) => state.dismissed);
  const { downloadAndInstall, restartApp, skipVersion } = useUpdateOperations();
  const [isDownloading, setIsDownloading] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);

  // Listen for restart cancelled event to reset button state
  useEffect(() => {
    const unlistenPromise = listen("update:restart-cancelled", () => {
      setIsRestarting(false);
    });

    return () => {
      safeUnlistenAsync(unlistenPromise);
    };
  }, []);

  // Reset isDownloading when status changes away from downloading
  useEffect(() => {
    if (status !== "downloading") {
      setIsDownloading(false);
    }
  }, [status]);

  if (!updateInfo) return null;

  // Don't show if dismissed (e.g., version was skipped)
  if (dismissed) return null;

  // Show card for available, downloading, or ready states
  if (status !== "available" && status !== "downloading" && status !== "ready") {
    return null;
  }

  const handleDownload = async () => {
    setIsDownloading(true);
    await downloadAndInstall();
  };

  const handleRestart = async () => {
    setIsRestarting(true);
    await restartApp();
  };

  const handleSkip = () => {
    skipVersion(updateInfo.version);
  };

  return (
    <SettingsGroup title={t("about.updateAvailable.group")}>
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-[var(--text-primary)]">
                {t("about.version", { version: updateInfo.version })}
              </span>
              {updateInfo.currentVersion && (
                <span className="text-xs text-[var(--text-tertiary)]">
                  {t("about.updateAvailable.current", { version: updateInfo.currentVersion })}
                </span>
              )}
            </div>
            {updateInfo.pubDate && (
              <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                {t("about.updateAvailable.released", { date: new Date(updateInfo.pubDate).toLocaleDateString() })}
              </div>
            )}
            {updateInfo.notes && (
              <div className="mt-2 text-sm text-[var(--text-secondary)] whitespace-pre-wrap line-clamp-3">
                {updateInfo.notes}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 shrink-0">
            {status === "available" && (
              <>
                <Button
                  variant="primary"
                  onClick={handleDownload}
                  disabled={isDownloading}
                  icon={isDownloading
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Download className="w-3 h-3" />
                  }
                >
                  {isDownloading ? t("about.downloading") : t("about.download")}
                </Button>
                <Button
                  variant="tertiary"
                  onClick={handleSkip}
                  icon={<SkipForward className="w-3 h-3" />}
                >
                  {t("about.skip")}
                </Button>
              </>
            )}

            {status === "ready" && (
              <Button
                variant="success"
                onClick={handleRestart}
                disabled={isRestarting}
                icon={isRestarting
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <RefreshCw className="w-3 h-3" />
                }
              >
                {isRestarting ? t("about.restarting") : t("about.restartToUpdate")}
              </Button>
            )}
          </div>
        </div>

        {status === "downloading" && <DownloadProgress />}
      </div>
    </SettingsGroup>
  );
}

export function AboutSettings() {
  const { t } = useTranslation("settings");
  const status = useUpdateStore((state) => state.status);
  const autoCheckEnabled = useSettingsStore((state) => state.update.autoCheckEnabled);
  const updateUpdateSetting = useSettingsStore((state) => state.updateUpdateSetting);
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
    </div>
  );
}
