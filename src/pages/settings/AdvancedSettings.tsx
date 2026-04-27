/**
 * Advanced Settings Section
 *
 * Developer and system configuration.
 */

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { imeToast as toast } from "@/utils/imeToast";
import { SettingRow, SettingsGroup, Toggle, TagInput } from "./components";
import { useSettingsStore } from "@/stores/settingsStore";
import { restartWithHotExit } from "@/utils/hotExit/restartWithHotExit";
import type { SessionData } from "@/utils/hotExit/types";
import { isMacPlatform } from "@/utils/shortcutMatch";

/**
 * Helper to wrap async operations with error handling
 */
async function withErrorHandling<T>(
  fn: () => Promise<T>,
  errorMessage: string
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    toast.error(errorMessage, {
      description: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function AdvancedSettings() {
  const { t } = useTranslation("settings");
  const [devTools, setDevTools] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const customLinkProtocols = useSettingsStore((state) => state.advanced.customLinkProtocols);
  const keepBothEditorsAlive = useSettingsStore((state) => state.advanced.keepBothEditorsAlive);
  const workflowEngine = useSettingsStore((state) => state.advanced.workflowEngine);
  const clearMacQuarantineOnOpen = useSettingsStore(
    (state) => state.advanced.clearMacQuarantineOnOpen
  );
  const updateAdvancedSetting = useSettingsStore((state) => state.updateAdvancedSetting);
  const isMac = isMacPlatform();

  return (
    <div>
      <SettingsGroup title={t("advanced.group.developer")}>
        <SettingRow label={t("advanced.devTools.label")} description={t("advanced.devTools.description")}>
          <Toggle checked={devTools} onChange={setDevTools} />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t("advanced.group.linkProtocols")}>
        <div className="py-2.5">
          <div className="text-sm font-medium text-[var(--text-primary)] mb-1">
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
      {devTools && (
        <SettingsGroup title={t("advanced.group.hotExitDevTools")}>
          <div className="py-2.5 space-y-3">
            <div className="text-sm text-[var(--text-secondary)] mb-3">
              {t("advanced.hotExit.hint")}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={async () => {
                  if (isBusy) return;
                  setIsBusy(true);
                  const session = await withErrorHandling(
                    () => invoke<SessionData>("hot_exit_capture"),
                    t("advanced.hotExit.captureFailed")
                  );
                  if (session) {
                    toast.success(t("advanced.hotExit.captureSuccess", { count: session.windows.length }), {
                      description: `v${session.vmark_version}`,
                    });
                  }
                  setIsBusy(false);
                }}
                disabled={isBusy}
                className="px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] hover:bg-[var(--hover-bg)] disabled:opacity-50 disabled:cursor-not-allowed rounded border border-[var(--border-color)] transition-colors"
              >
                {t("advanced.hotExit.testCapture")}
              </button>

              <button
                onClick={async () => {
                  if (isBusy) return;
                  setIsBusy(true);
                  const session = await withErrorHandling(
                    () => invoke<SessionData | null>("hot_exit_inspect_session"),
                    t("advanced.hotExit.inspectFailed")
                  );
                  if (session) {
                    const age = Math.max(0, Math.floor((Date.now() - session.timestamp * 1000) / 1000));
                    toast.info(t("advanced.hotExit.sessionFound", { age }), {
                      description: t("advanced.hotExit.sessionFoundDetail", { count: session.windows.length, version: session.vmark_version }),
                    });
                  } else if (session === null) {
                    toast.info(t("advanced.hotExit.noSession"));
                  }
                  setIsBusy(false);
                }}
                disabled={isBusy}
                className="px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] hover:bg-[var(--hover-bg)] disabled:opacity-50 disabled:cursor-not-allowed rounded border border-[var(--border-color)] transition-colors"
              >
                {t("advanced.hotExit.inspectSession")}
              </button>

              <button
                onClick={async () => {
                  if (isBusy) return;
                  setIsBusy(true);
                  const session = await withErrorHandling(
                    () => invoke<SessionData | null>("hot_exit_inspect_session"),
                    t("advanced.hotExit.restoreFailed")
                  );
                  if (session) {
                    const result = await withErrorHandling(
                      () => invoke<void>("hot_exit_restore", { session }),
                      t("advanced.hotExit.restoreFailed")
                    );
                    if (result !== null) {
                      toast.success(t("advanced.hotExit.restoreSuccess"));
                    }
                  } else if (session === null) {
                    toast.info(t("advanced.hotExit.noSessionToRestore"));
                  }
                  setIsBusy(false);
                }}
                disabled={isBusy}
                className="px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] hover:bg-[var(--hover-bg)] disabled:opacity-50 disabled:cursor-not-allowed rounded border border-[var(--border-color)] transition-colors"
              >
                {t("advanced.hotExit.testRestore")}
              </button>

              <button
                onClick={async () => {
                  if (isBusy) return;
                  setIsBusy(true);
                  const result = await withErrorHandling(
                    () => invoke<void>("hot_exit_clear_session"),
                    t("advanced.hotExit.clearFailed")
                  );
                  if (result !== null) {
                    toast.success(t("advanced.hotExit.sessionCleared"));
                  }
                  setIsBusy(false);
                }}
                disabled={isBusy}
                className="px-3 py-1.5 text-sm bg-[var(--error-bg)] hover:bg-[var(--error-color)] hover:text-[var(--contrast-text)] disabled:opacity-50 disabled:cursor-not-allowed text-[var(--error-color)] rounded border border-[var(--error-color)] transition-colors"
              >
                {t("advanced.hotExit.clearSession")}
              </button>

              <button
                onClick={async () => {
                  if (isBusy) return;
                  setIsBusy(true);
                  await withErrorHandling(
                    () => restartWithHotExit(),
                    t("advanced.hotExit.restartFailed")
                  );
                  // Note: If restart succeeds, app will close - setIsBusy won't run
                }}
                disabled={isBusy}
                className="px-3 py-1.5 text-sm bg-[var(--primary-color)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-[var(--contrast-text)] rounded border border-[var(--primary-color)] transition-opacity"
              >
                {t("advanced.hotExit.testRestart")}
              </button>
            </div>
          </div>
        </SettingsGroup>
      )}
    </div>
  );
}
