/**
 * useAutoSaveDisplay
 *
 * Purpose: Owns the StatusBar auto-save indicator's transient display state.
 * On each new auto-save it shows a relative-time label, keeps it current on a
 * 10s interval, and fades it out after 5s while continuing to update in the
 * background so a re-show is accurate. Extracted from StatusBar so that
 * component is less of a catch-all.
 *
 * @coordinates-with StatusBar.tsx — sole caller
 * @coordinates-with utils/dateUtils — formatRelativeTime
 * @module components/StatusBar/useAutoSaveDisplay
 */
import { useEffect, useState } from "react";
import { formatRelativeTime } from "@/utils/dateUtils";

export interface AutoSaveDisplay {
  /** Whether the indicator is currently visible (true for 5s after a save). */
  showAutoSave: boolean;
  /** The relative-time label (e.g. "3s ago"). */
  autoSaveTime: string;
}

export function useAutoSaveDisplay(
  lastAutoSave: number | null,
): AutoSaveDisplay {
  const [showAutoSave, setShowAutoSave] = useState(false);
  const [autoSaveTime, setAutoSaveTime] = useState("");

  // Legitimate setState-in-effect: shows the "auto-saved" badge in response to a
  // new save timestamp and refreshes the relative time on a timer — driven by an
  // external event + timers, not derivable during render (#1063).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!lastAutoSave) return;

    setAutoSaveTime(formatRelativeTime(lastAutoSave));
    setShowAutoSave(true);

    const updateInterval = setInterval(() => {
      setAutoSaveTime(formatRelativeTime(lastAutoSave));
    }, 10000);

    const fadeTimeout = setTimeout(() => {
      setShowAutoSave(false);
    }, 5000);

    return () => {
      clearInterval(updateInterval);
      clearTimeout(fadeTimeout);
    };
  }, [lastAutoSave]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return { showAutoSave, autoSaveTime };
}
