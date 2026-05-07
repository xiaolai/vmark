/**
 * Formats upgrade nudge.
 *
 * One-time toast that surfaces the new opt-in format support. Fires on
 * the FIRST app launch after this branch ships and is then never shown
 * again (the `formats.upgradeNudgeShown` flag persists via the settings
 * store).
 *
 * Why a nudge at all: the multi-format rebrand markets a capability
 * ("the plain-text workspace where humans and AI collaborate"), but
 * defaults are calm — only markdown, plain text, and YAML are on out
 * of the box. Without a discovery hint, users would never find the
 * Formats settings panel and the launch narrative would mislead.
 *
 * Why not a modal: interruption cost. A non-blocking toast respects
 * the user's actual session and can be dismissed cheaply.
 *
 * @coordinates-with stores/settingsStore.ts — reads + writes upgradeNudgeShown
 * @module hooks/useFormatsUpgradeNudge
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { imeToast as toast } from "@/utils/imeToast";
import { useSettingsStore } from "@/stores/settingsStore";
import { openSettingsWindow } from "@/utils/settingsWindow";

export function useFormatsUpgradeNudge(): void {
  const { t } = useTranslation("settings");

  useEffect(() => {
    // Only the main window owns the nudge. With multi-window setups
    // (one main + N spawned doc windows), the toast fired in every
    // window before this gate, then `upgradeNudgeShown` got persisted
    // by whichever raced first — duplicates were visible to the user.
    const windowLabel = getCurrentWebviewWindow().label;
    if (windowLabel !== "main") return;

    const formats = useSettingsStore.getState().formats;
    if (formats.upgradeNudgeShown) return;

    // Don't nudge if the user has already enabled at least one category —
    // they've clearly found Settings and made a choice.
    const someEnabled =
      formats.dataFormats ||
      formats.diagrams ||
      formats.htmlPreview ||
      formats.codeViewers;
    if (someEnabled) {
      useSettingsStore.getState().updateFormatsSetting("upgradeNudgeShown", true);
      return;
    }

    // Mark shown immediately when the timer is scheduled, not when the
    // toast actually fires. This prevents a re-mount race during cold
    // start (HMR, fast settings reload) from queueing a second nudge.
    useSettingsStore
      .getState()
      .updateFormatsSetting("upgradeNudgeShown", true);

    // Brief delay so the toast doesn't compete with workspace-restore
    // messages on cold start.
    const id = window.setTimeout(() => {
      toast.info(t("formats.nudge.title"), {
        description: t("formats.nudge.description"),
        duration: 12_000,
        action: {
          label: t("formats.nudge.openSettings"),
          // Use the canonical helper instead of the timing-fragile
          // emit("menu:settings") + setTimeout(350) hack. This
          // guarantees the navigate event lands after the Settings
          // window is mounted (the helper handles both spawn and
          // existing-window paths).
          onClick: () => {
            void openSettingsWindow("formats");
          },
        },
      });
    }, 1500);

    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
