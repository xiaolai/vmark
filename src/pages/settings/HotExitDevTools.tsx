/**
 * Hot-exit developer tools — capture / inspect / restore / clear / restart.
 *
 * Purpose: exercise the hot-exit session pipeline from Settings without a real
 * update cycle. Rendered by AdvancedSettings behind the developer-mode toggle.
 *
 * Key decisions:
 *   - One runner (`runExclusive`) owns the busy flag for every button, and
 *     clears it in `finally` — a rejected restart used to leave the whole
 *     group permanently disabled.
 *   - `withErrorHandling` returns a discriminated `Outcome`, so a command that
 *     *succeeds* with `null` (no saved session) stays distinguishable from a
 *     command that *failed*. Collapsing both to `null` made a failed invoke
 *     report "No saved session" on top of its own error toast.
 *
 * @coordinates-with services/persistence/hotExit — the commands under test
 * @module pages/settings/HotExitDevTools
 */

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { imeToast as toast } from "@/services/ime/imeToast";
import { Button, SettingsGroup } from "./components";
import { restartWithHotExit } from "@/services/persistence/hotExit/restartWithHotExit";
import { restoreCommandFor } from "@/services/persistence/hotExit/restoreDispatch";
import type { SessionData } from "@/services/persistence/hotExit/types";

/** Outcome of a guarded async call — success (with its value, which may
 *  legitimately be `null`) or failure (already reported to the user). */
type Outcome<T> = { ok: true; value: T } | { ok: false };

/** Run an async operation, surfacing failures as an error toast. */
async function withErrorHandling<T>(
  fn: () => Promise<T>,
  errorMessage: string
): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    toast.error(errorMessage, {
      description: error instanceof Error ? error.message : String(error),
    });
    return { ok: false };
  }
}

interface HotExitAction {
  label: string;
  variant: "tertiary" | "danger" | "primary";
  run: () => Promise<void>;
}

export function HotExitDevTools() {
  const { t } = useTranslation("settings");
  const [isBusy, setIsBusy] = useState(false);

  const runExclusive = async (action: () => Promise<void>) => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      await action();
    } finally {
      // Always reached on failure. On a successful restart the app is already
      // tearing down, so this last state update simply never lands.
      setIsBusy(false);
    }
  };

  const actions: HotExitAction[] = [
    {
      label: t("advanced.hotExit.testCapture"),
      variant: "tertiary",
      run: async () => {
        const captured = await withErrorHandling(
          () => invoke<SessionData>("hot_exit_capture"),
          t("advanced.hotExit.captureFailed")
        );
        if (!captured.ok) return;
        toast.success(
          t("advanced.hotExit.captureSuccess", { count: captured.value.windows.length }),
          { description: `v${captured.value.vmark_version}` }
        );
      },
    },
    {
      label: t("advanced.hotExit.inspectSession"),
      variant: "tertiary",
      run: async () => {
        const inspected = await withErrorHandling(
          () => invoke<SessionData | null>("hot_exit_inspect_session"),
          t("advanced.hotExit.inspectFailed")
        );
        if (!inspected.ok) return;
        const session = inspected.value;
        if (!session) {
          toast.info(t("advanced.hotExit.noSession"));
          return;
        }
        const age = Math.max(0, Math.floor((Date.now() - session.timestamp * 1000) / 1000));
        toast.info(t("advanced.hotExit.sessionFound", { age }), {
          description: t("advanced.hotExit.sessionFoundDetail", {
            count: session.windows.length,
            version: session.vmark_version,
          }),
        });
      },
    },
    {
      label: t("advanced.hotExit.testRestore"),
      variant: "tertiary",
      run: async () => {
        const inspected = await withErrorHandling(
          () => invoke<SessionData | null>("hot_exit_inspect_session"),
          t("advanced.hotExit.restoreFailed")
        );
        if (!inspected.ok) return;
        const session = inspected.value;
        if (!session) {
          toast.info(t("advanced.hotExit.noSessionToRestore"));
          return;
        }
        // Match the auto-restore flow: a multi-window session must use the
        // multi-window command, or secondary windows are silently dropped (#970).
        const restored = await withErrorHandling(
          () => invoke<void>(restoreCommandFor(session), { session }),
          t("advanced.hotExit.restoreFailed")
        );
        if (restored.ok) toast.success(t("advanced.hotExit.restoreSuccess"));
      },
    },
    {
      label: t("advanced.hotExit.clearSession"),
      variant: "danger",
      run: async () => {
        const cleared = await withErrorHandling(
          () => invoke<void>("hot_exit_clear_session"),
          t("advanced.hotExit.clearFailed")
        );
        if (cleared.ok) toast.success(t("advanced.hotExit.sessionCleared"));
      },
    },
    {
      label: t("advanced.hotExit.testRestart"),
      variant: "primary",
      run: async () => {
        await withErrorHandling(
          () => restartWithHotExit(),
          t("advanced.hotExit.restartFailed")
        );
      },
    },
  ];

  return (
    <SettingsGroup title={t("advanced.group.hotExitDevTools")}>
      <div className="py-2.5 space-y-3">
        <div className="text-sm text-[var(--text-secondary)] mb-3">
          {t("advanced.hotExit.hint")}
        </div>

        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action.label}
              variant={action.variant}
              size="md"
              disabled={isBusy}
              onClick={() => void runExclusive(action.run)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>
    </SettingsGroup>
  );
}
