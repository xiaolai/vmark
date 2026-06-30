/**
 * Update-available card (Settings → About).
 *
 * Renders the version/notes panel plus the download/install controls and the
 * progress bar. Extracted from AboutSettings.tsx.
 *
 * Key decisions:
 *   - The bar shows during BOTH "downloading" and "installing". On the
 *     updater's `Finished` event the bytes are in but the package is still
 *     being written — we show "Installing…" at 100% rather than a frozen bar.
 *   - Indeterminate mode when the server sent no Content-Length: an animated
 *     bar + "X.X MB downloaded" instead of a bar stuck at 0%.
 *   - The card stays mounted through the "checking" re-check the Settings
 *     download path runs (pendingUpdate is window-local), so the button
 *     doesn't vanish-then-reappear. Busy state is derived from `status`.
 *
 * @coordinates-with useUpdateOperations.ts — download/restart/skip
 * @coordinates-with mcpStore.ts — `update` slice (status, info, progress)
 * @module pages/settings/UpdateAvailableCard
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { Loader2, Download, RefreshCw, SkipForward } from "lucide-react";
import { SettingsGroup, Button } from "./components";
import { useMcpStore } from "@/stores/mcpStore";
import { useUpdateOperations } from "@/hooks/useUpdateOperations";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";

/** Download/install progress bar. Determinate, indeterminate, and installing. */
function DownloadProgress() {
  const { t } = useTranslation("settings");
  const status = useMcpStore((state) => state.update.status);
  const downloadProgress = useMcpStore((state) => state.update.downloadProgress);

  // Shown during the network download and the install phase that follows it.
  if (status !== "downloading" && status !== "installing") return null;

  const installing = status === "installing";
  const downloaded = downloadProgress?.downloaded ?? 0;
  const total = downloadProgress?.total ?? null;
  // Indeterminate: downloading with no Content-Length — percent is unknowable.
  const indeterminate = !installing && !(total !== null && total > 0);
  const percent =
    total !== null && total > 0
      ? Math.min(100, Math.round((downloaded / total) * 100))
      : null;
  const downloadedMB = (downloaded / 1024 / 1024).toFixed(1);
  const totalMB =
    total !== null && total > 0 ? (total / 1024 / 1024).toFixed(1) : null;
  const downloadedText = t("about.downloadProgress.downloaded", { mb: downloadedMB });

  const label = installing
    ? t("about.downloadProgress.installing")
    : t("about.downloadProgress.label");
  const detail = installing
    ? ""
    : indeterminate
      ? downloadedText
      : `${downloadedMB} / ${totalMB} MB (${percent}%)`;

  // Determinate exposes aria-valuenow; indeterminate omits it (per WAI-ARIA)
  // and supplies aria-valuetext so screen readers announce bytes, not 0.
  const valueNow = installing ? 100 : percent;

  return (
    <div className="mt-2 space-y-1">
      <div className="flex justify-between text-xs text-[var(--text-tertiary)]">
        <span>{label}</span>
        {detail && <span>{detail}</span>}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={valueNow ?? undefined}
        aria-valuetext={indeterminate ? downloadedText : undefined}
        className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden"
      >
        <div
          className={`h-full bg-[var(--primary-color)] transition-all duration-300 ${
            indeterminate ? "animate-pulse" : ""
          }`}
          style={{ width: indeterminate ? "100%" : `${valueNow ?? 0}%` }}
        />
      </div>
    </div>
  );
}

export function UpdateAvailableCard() {
  const { t } = useTranslation("settings");
  const status = useMcpStore((state) => state.update.status);
  const updateInfo = useMcpStore((state) => state.update.updateInfo);
  const dismissed = useMcpStore((state) => state.update.dismissed);
  const { downloadAndInstall, restartApp, skipVersion } = useUpdateOperations();
  const [isRestarting, setIsRestarting] = useState(false);

  useEffect(() => {
    const unlistenPromise = listen("update:restart-cancelled", () => setIsRestarting(false));
    return () => {
      safeUnlistenAsync(unlistenPromise);
    };
  }, []);

  if (!updateInfo) return null; // initial check (no info yet) → keep hidden
  if (dismissed) return null; // version skipped

  // Stay mounted across the whole flow — including the "checking" re-check the
  // download path runs — so the button doesn't flicker out and back.
  const active =
    status === "available" ||
    status === "checking" ||
    status === "downloading" ||
    status === "installing" ||
    status === "ready";
  if (!active) return null;

  // An operation is in flight: primary button shows a spinner and is disabled.
  const busy = status === "checking" || status === "downloading" || status === "installing";
  const downloadLabel =
    status === "installing"
      ? t("about.installing")
      : busy
        ? t("about.downloading")
        : t("about.download");

  const handleDownload = () => {
    void downloadAndInstall();
  };
  const handleRestart = () => {
    setIsRestarting(true);
    void restartApp();
  };
  const handleSkip = () => skipVersion(updateInfo.version);

  return (
    <SettingsGroup title={t("about.updateAvailable.group")}>
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-[var(--text-color)]">
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
                {t("about.updateAvailable.released", {
                  date: new Date(updateInfo.pubDate).toLocaleDateString(),
                })}
              </div>
            )}
            {updateInfo.notes && (
              <div className="mt-2 text-sm text-[var(--text-secondary)] whitespace-pre-wrap line-clamp-3">
                {updateInfo.notes}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 shrink-0">
            {status === "ready" ? (
              <Button
                variant="success"
                onClick={handleRestart}
                disabled={isRestarting}
                icon={
                  isRestarting ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )
                }
              >
                {isRestarting ? t("about.restarting") : t("about.restartToUpdate")}
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  onClick={handleDownload}
                  disabled={busy}
                  icon={
                    busy ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Download className="w-3 h-3" />
                    )
                  }
                >
                  {downloadLabel}
                </Button>
                {status === "available" && (
                  <Button
                    variant="tertiary"
                    onClick={handleSkip}
                    icon={<SkipForward className="w-3 h-3" />}
                  >
                    {t("about.skip")}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        <DownloadProgress />
      </div>
    </SettingsGroup>
  );
}
