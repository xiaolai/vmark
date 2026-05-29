/**
 * useHotExitCaptureWarning
 *
 * Purpose: Surface a warning when hot-exit session capture is incomplete.
 * When a window does not respond before CAPTURE_TIMEOUT_SECS, the Rust
 * coordinator saves a partial session and emits `hot-exit:partial-capture`.
 * Without a listener the user gets no signal that unsaved work in the
 * timed-out window may have been dropped — the green "captured" path looks
 * like success (#969).
 *
 * Key decisions:
 *   - Global listen(): Rust emits via app.emit() (global broadcast).
 *   - Warning toast (not info/success) so it is urgent and not IME-deferred.
 *   - Listens for both partial-capture and capture-timeout for resilience to
 *     which event the coordinator emits.
 *
 * @coordinates-with src-tauri/src/hot_exit/coordinator.rs — emits partial-capture
 * @module services/persistence/hotExit/useHotExitCaptureWarning
 */
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { HOT_EXIT_EVENTS } from "./types";

interface PartialCapturePayload {
  captured?: number;
  expected?: number;
  missing?: string[];
}

/** Warn the user when hot-exit capture drops one or more windows. */
export function useHotExitCaptureWarning(): void {
  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const warn = (payload: PartialCapturePayload | undefined) => {
      const missing = payload?.missing ?? [];
      const windows =
        missing.length > 0
          ? missing.join(", ")
          : i18n.t("common:hotExit.partialCapture.unknownWindows");
      toast.warning(i18n.t("common:hotExit.partialCapture.title"), {
        description: i18n.t("common:hotExit.partialCapture.description", { windows }),
      });
    };

    const register = (event: string) => {
      listen<PartialCapturePayload>(event, (e) => warn(e.payload)).then(
        (un) => {
          if (cancelled) un();
          else unlisteners.push(un);
        },
      );
    };

    register(HOT_EXIT_EVENTS.PARTIAL_CAPTURE);
    register(HOT_EXIT_EVENTS.CAPTURE_TIMEOUT);

    return () => {
      cancelled = true;
      unlisteners.forEach((un) => un());
    };
  }, []);
}
