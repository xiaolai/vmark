/**
 * Status toasts (WI-UB3, re-audit 20260901)
 *
 * Purpose: the status bar's RARE states — update lifecycle, auto-save
 * paused, divergent — live as transient/sticky toasts instead of inline
 * chrome, so the bar stops accreting an item per feature. The always-
 * relevant chrome (counts, lint, AI, MCP, terminal/mode/lock) stays inline.
 *
 * Key decisions:
 *   - The update TOAST DECISION is a pure function (`updateToastDescriptor`)
 *     so every state × stalled combination is table-testable; the hook is a
 *     thin effect over it.
 *   - One shared toast id per concern ("status-update", "status-autosave-
 *     paused", "status-divergent"): a state transition REPLACES the previous
 *     toast rather than stacking, and a falling edge dismisses it.
 *   - Actionable states are STICKY (duration: Infinity) — ready/error/
 *     stalled carry the only recovery affordance now that the inline icon is
 *     gone; purely informational `available` auto-dismisses.
 *   - Transient states (checking/downloading/installing) are silent. The
 *     stall detector covers the case where silence would strand the user:
 *     a stalled flow raises a sticky warning with a Reset action (#1270).
 *   - Priority mirrors the old inline badges: while auto-save is paused the
 *     divergent toast stays quiet — one story at a time about the same file.
 *   - Toasts go through imeToast (never raw sonner) so a CJK composition is
 *     never interrupted; warning/error pass through immediately by design.
 *
 * @coordinates-with components/StatusBar/StatusBar.tsx — mounts both hooks
 * @coordinates-with hooks/useUpdateOperations.ts — restart/retry/recover actions
 * @coordinates-with hooks/useUpdateStall.ts — the stall signal
 * @module hooks/useStatusToasts
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useMcpStore, type UpdateStatus } from "@/stores/mcpStore";
import { useSettingsStore, formatKeyForDisplay } from "@/stores/settingsStore";
import { useUpdateOperations, recoverFromStall } from "@/hooks/useUpdateOperations";
import { useUpdateStall } from "@/hooks/useUpdateStall";
import { openSettingsWindow } from "@/services/navigation/settingsWindow";
import { imeToast } from "@/services/ime/imeToast";
import { appError } from "@/utils/debug";

const UPDATE_TOAST_ID = "status-update";
const AUTOSAVE_PAUSED_TOAST_ID = "status-autosave-paused";
const DIVERGENT_TOAST_ID = "status-divergent";

export interface UpdateToastDescriptor {
  kind: "info" | "success" | "error" | "warning";
  /** statusbar-namespace message key (the -Version form when a version is known). */
  messageKey:
    | "updateAvailable"
    | "updateAvailableVersion"
    | "updateReady"
    | "updateReadyVersion"
    | "updateError"
    | "updateStalled";
  /** statusbar-namespace label key for the action button. */
  actionKey: "updateViewAction" | "updateRestartAction" | "updateRetryAction";
  action: "view" | "restart" | "retry" | "recover";
  sticky: boolean;
}

/**
 * What (if anything) the update lifecycle should show as a toast.
 * Pure — exhaustively table-tested in useStatusToasts.test.tsx.
 */
export function updateToastDescriptor(
  status: UpdateStatus,
  prevStatus: UpdateStatus,
  stalled: boolean,
  autoDownload: boolean,
  version: string | null,
): UpdateToastDescriptor | null {
  // A stalled flow outranks its nominal status: checking/downloading/
  // installing are non-interactive, so the toast is the only way out.
  if (stalled) {
    return {
      kind: "warning",
      messageKey: "updateStalled",
      actionKey: "updateRetryAction",
      action: "recover",
      sticky: true,
    };
  }
  switch (status) {
    case "available":
      // Auto-download consumes `available` immediately — announcing it would
      // toast every launch for a state the user never has to act on.
      if (autoDownload) return null;
      return {
        kind: "info",
        messageKey: version ? "updateAvailableVersion" : "updateAvailable",
        actionKey: "updateViewAction",
        action: "view",
        sticky: false,
      };
    case "ready":
      return {
        kind: "success",
        messageKey: version ? "updateReadyVersion" : "updateReady",
        actionKey: "updateRestartAction",
        action: "restart",
        sticky: true,
      };
    case "error":
      // ONLY transfer failures (download/install died) toast here. CHECK
      // errors belong to useUpdateChecker: manual checks get the real error
      // message there, and background flaps stay deliberately quiet — a
      // sticky toast on every retry would undo that decision.
      if (prevStatus !== "downloading" && prevStatus !== "installing") return null;
      return {
        kind: "error",
        messageKey: "updateError",
        actionKey: "updateRetryAction",
        action: "retry",
        sticky: true,
      };
    default:
      return null;
  }
}

/** One mount for the status bar: update lifecycle + save-state toasts. */
export function useStatusToasts(
  showAutoSavePaused: boolean,
  isDivergent: boolean,
  saveShortcut: string,
): void {
  useUpdateToasts();
  useSaveStateToasts(showAutoSavePaused, isDivergent, saveShortcut);
}

/** Update lifecycle → toasts. Mounted once, by the status bar. */
export function useUpdateToasts(): void {
  const { t } = useTranslation("statusbar");
  const status = useMcpStore((state) => state.update.status);
  const version = useMcpStore((state) => state.update.updateInfo?.version ?? null);
  const autoDownload = useSettingsStore((state) => state.update.autoDownload);
  const stalled = useUpdateStall();
  const { checkForUpdates, restartApp } = useUpdateOperations();
  const prevStatusRef = useRef<UpdateStatus>(status);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;
    const desc = updateToastDescriptor(status, prevStatus, stalled, autoDownload, version);
    if (!desc) {
      imeToast.dismiss(UPDATE_TOAST_ID);
      return;
    }
    const onClick = () => {
      if (desc.action === "recover") recoverFromStall();
      else if (desc.action === "view")
        void Promise.resolve(openSettingsWindow("about")).catch((e) =>
          appError("Failed to open settings window:", e),
        );
      else if (desc.action === "restart")
        void Promise.resolve(restartApp()).catch((e) =>
          appError("Failed to restart for update:", e),
        );
      else
        void Promise.resolve(checkForUpdates()).catch((e) =>
          appError("Update check failed:", e),
        );
    };
    const message = version ? t(desc.messageKey, { version }) : t(desc.messageKey);
    imeToast[desc.kind](message, {
      id: UPDATE_TOAST_ID,
      ...(desc.sticky ? { duration: Infinity } : {}),
      action: { label: t(desc.actionKey), onClick },
    });
  }, [status, stalled, autoDownload, version, t, checkForUpdates, restartApp]);
}

/**
 * Auto-save-paused / divergent → sticky warnings. Both protect unsaved
 * work, so they stay visible until the state clears; paused outranks
 * divergent exactly as the old inline badges did.
 */
export function useSaveStateToasts(
  showAutoSavePaused: boolean,
  isDivergent: boolean,
  saveShortcut: string,
): void {
  const { t } = useTranslation("statusbar");
  const shortcut = formatKeyForDisplay(saveShortcut);

  useEffect(() => {
    if (showAutoSavePaused) {
      imeToast.warning(t("autoSavePausedTitle", { shortcut }), {
        id: AUTOSAVE_PAUSED_TOAST_ID,
        duration: Infinity,
      });
      return;
    }
    imeToast.dismiss(AUTOSAVE_PAUSED_TOAST_ID);
  }, [showAutoSavePaused, shortcut, t]);

  useEffect(() => {
    if (isDivergent && !showAutoSavePaused) {
      imeToast.warning(t("divergentTitle", { shortcut }), {
        id: DIVERGENT_TOAST_ID,
        duration: Infinity,
      });
      return;
    }
    imeToast.dismiss(DIVERGENT_TOAST_ID);
  }, [isDivergent, showAutoSavePaused, shortcut, t]);
}
