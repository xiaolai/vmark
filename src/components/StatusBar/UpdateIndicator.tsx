/**
 * Update Indicator Component
 *
 * Shows update status in the StatusBar:
 * - Hidden when idle or up-to-date
 * - Spinning icon when checking or downloading
 * - Static icon with dot when available or ready
 * - Error icon when error
 */

import { RefreshCw, Download, CheckCircle, AlertCircle } from "lucide-react";
import { useUpdateStore, type UpdateStatus } from "@/stores/updateStore";
import { useUpdateOperations } from "@/hooks/useUpdateOperations";

/**
 * Get indicator config based on update status
 */
function getIndicatorConfig(status: UpdateStatus) {
  switch (status) {
    case "checking":
      return {
        icon: RefreshCw,
        label: "Checking...",
        title: "Checking for updates...",
        className: "status-update checking",
        showDot: false,
      };
    case "downloading":
      return {
        icon: Download,
        label: "Updating...",
        title: "Downloading update...",
        className: "status-update downloading",
        showDot: false,
      };
    case "available":
      return {
        icon: Download,
        label: "Update",
        title: "Update available — click to download",
        className: "status-update available",
        showDot: true,
      };
    case "ready":
      return {
        icon: CheckCircle,
        label: "Restart",
        title: "Update ready — click to restart",
        className: "status-update ready",
        showDot: true,
      };
    case "error":
      return {
        icon: AlertCircle,
        label: "Error",
        title: "Update check failed — click to retry",
        className: "status-update error",
        showDot: false,
      };
    default:
      return null;
  }
}

export function UpdateIndicator() {
  const status = useUpdateStore((state) => state.status);
  const updateInfo = useUpdateStore((state) => state.updateInfo);
  const downloadProgress = useUpdateStore((state) => state.downloadProgress);
  const { checkForUpdates, downloadAndInstall, restartApp } = useUpdateOperations();

  const config = getIndicatorConfig(status);

  // Don't render for idle or up-to-date states
  if (!config) return null;

  const Icon = config.icon;

  // Build title with additional context
  let title = config.title;
  if (status === "available" && updateInfo) {
    title = `Update available: v${updateInfo.version} — click to download`;
  } else if (status === "downloading" && downloadProgress) {
    const percent = downloadProgress.total
      ? Math.round((downloadProgress.downloaded / downloadProgress.total) * 100)
      : null;
    title = percent !== null ? `Downloading update: ${percent}%` : "Downloading update...";
  } else if (status === "ready" && updateInfo) {
    title = `v${updateInfo.version} ready — click to restart`;
  }

  const handleClick = () => {
    switch (status) {
      case "available":
        downloadAndInstall();
        break;
      case "ready":
        restartApp();
        break;
      case "error":
        checkForUpdates();
        break;
      // checking/downloading: no action (already in progress)
    }
  };

  const isClickable = status === "available" || status === "ready" || status === "error";

  return (
    <button
      className={config.className}
      onClick={handleClick}
      title={title}
      disabled={!isClickable}
      style={{ cursor: isClickable ? "pointer" : "default" }}
    >
      <Icon size={12} />
      <span className="status-update-label">{config.label}</span>
      {config.showDot && <span className="status-update-dot" />}
    </button>
  );
}

export default UpdateIndicator;
