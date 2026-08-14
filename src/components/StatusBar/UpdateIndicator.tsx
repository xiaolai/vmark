/**
 * Update Indicator Component
 *
 * Shows update status in the StatusBar as icon-only:
 * - Hidden when idle, up-to-date, or available (with auto-download)
 * - Spinning icon when checking (no action)
 * - Pulsing icon when available (click to open Settings → About)
 * - Pulsing icon when downloading or installing (no action)
 * - Static icon with dot when ready (click to restart)
 * - Error icon when error (click to retry)
 */

import { useTranslation } from "react-i18next";
import { RefreshCw, Download, CheckCircle, AlertCircle } from "lucide-react";
import { useMcpStore, type UpdateStatus } from "@/stores/mcpStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUpdateOperations, recoverFromStall } from "@/hooks/useUpdateOperations";
import { useUpdateStall } from "@/hooks/useUpdateStall";
import { openSettingsWindow } from "@/services/navigation/settingsWindow";
import { appError } from "@/utils/debug";

/**
 * Get indicator config based on update status (title is a translation key resolved in the component).
 */
function getIndicatorConfig(status: UpdateStatus) {
  switch (status) {
    case "checking":
      return {
        icon: RefreshCw,
        titleKey: "updateChecking" as const,
        className: "status-update checking",
        showDot: false,
        clickable: false,
      };
    case "downloading":
      return {
        icon: Download,
        titleKey: "updateDownloading" as const,
        className: "status-update downloading",
        showDot: false,
        clickable: false,
      };
    case "installing":
      return {
        icon: Download,
        titleKey: "updateInstalling" as const,
        className: "status-update downloading",
        showDot: false,
        clickable: false,
      };
    case "available":
      return {
        icon: Download,
        titleKey: "updateAvailable" as const,
        className: "status-update available",
        showDot: true,
        clickable: true,
      };
    case "ready":
      return {
        icon: CheckCircle,
        titleKey: "updateReady" as const,
        className: "status-update ready",
        showDot: true,
        clickable: true,
      };
    case "error":
      return {
        icon: AlertCircle,
        titleKey: "updateError" as const,
        className: "status-update error",
        showDot: false,
        clickable: true,
      };
    default:
      return null;
  }
}

/** Renders an update status icon in the StatusBar (checking, downloading, ready, or error). */
export function UpdateIndicator() {
  const { t } = useTranslation("statusbar");
  const status = useMcpStore((state) => state.update.status);
  const updateInfo = useMcpStore((state) => state.update.updateInfo);
  const downloadProgress = useMcpStore((state) => state.update.downloadProgress);
  const autoDownload = useSettingsStore((state) => state.update.autoDownload);
  const { checkForUpdates, restartApp } = useUpdateOperations();
  // `checking`/`downloading`/`installing` are non-interactive, so a flow that
  // stops progressing has no way out — the guard is never released and every
  // retry joins a promise that will never settle (#1270).
  const stalled = useUpdateStall();

  const config = getIndicatorConfig(status);

  // Don't render for idle or up-to-date states
  if (!config) return null;

  // Skip "available" state when auto-download is on (it transitions immediately to downloading)
  if (status === "available" && autoDownload) return null;

  const Icon = config.icon;

  // Calculate download percentage for tooltip
  const downloadPercent =
    status === "downloading" && downloadProgress?.total
      ? Math.round((downloadProgress.downloaded / downloadProgress.total) * 100)
      : null;

  // A stalled flow overrides the config: it becomes clickable regardless of
  // the state's normal interactivity, and says so.
  const clickable = config.clickable || stalled;

  // Build title with additional context
  let title = t(config.titleKey);
  if (stalled) {
    title = t("updateStalled");
  } else if (status === "available" && updateInfo) {
    title = t("updateAvailableVersion", { version: updateInfo.version });
  } else if (status === "downloading") {
    title = downloadPercent !== null ? t("updateDownloadingPercent", { percent: downloadPercent }) : t("updateDownloading");
  } else if (status === "ready" && updateInfo) {
    title = t("updateReadyVersion", { version: updateInfo.version });
  }

  const handleClick = () => {
    if (!clickable) return;

    // Checked before the status chain: a stalled `checking`/`downloading`
    // matches none of those branches, and a stalled `error` should reset
    // rather than fire another check into the same stuck guard.
    if (stalled) {
      recoverFromStall();
      return;
    }

    /* v8 ignore start -- @preserve reason: status branch chain (available/ready/error) not fully exercised in tests */
    if (status === "available") {
      void Promise.resolve(openSettingsWindow("about")).catch((e) => appError("Failed to open settings window:", e));
    } else if (status === "ready") {
      void Promise.resolve(restartApp()).catch((e) => appError("Failed to restart for update:", e));
    } else if (status === "error") {
      void Promise.resolve(checkForUpdates()).catch((e) => appError("Update check failed:", e));
    }
    /* v8 ignore stop */
  };

  return (
    <button
      className={config.className}
      onClick={handleClick}
      title={title}
      aria-label={title}
      style={{ cursor: clickable ? "pointer" : "default" }}
    >
      <Icon size={12} />
      {config.showDot && <span className="status-update-dot" />}
    </button>
  );
}
