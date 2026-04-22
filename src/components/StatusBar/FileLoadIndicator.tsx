/**
 * File Load Indicator
 *
 * Purpose: Shows an honest indeterminate spinner + label while a large WYSIWYG
 * open is in progress. The label does not claim sub-phase progress — while
 * ProseMirror builds the view the main thread is frozen, so there is no
 * meaningful progress to report.
 *
 * Accessibility:
 *   - `role="status"` + `aria-live="polite"` announces the start once.
 *   - Label does not update during the wait; re-announcing would spam SR users.
 *
 * Visibility:
 *   - Active only when `useFileLoadStore.active` is true.
 *   - CSS fades in after a 150 ms delay so fast opens never flash the indicator.
 *
 * @coordinates-with stores/fileLoadStore.ts — reads active/filename/sizeBytes.
 * @coordinates-with utils/fileSizeThresholds.ts — formatFileSize for the label.
 * @module components/StatusBar/FileLoadIndicator
 */

import { useTranslation } from "react-i18next";
import { useFileLoadStore } from "@/stores/fileLoadStore";
import { formatFileSize } from "@/utils/fileSizeThresholds";

export function FileLoadIndicator() {
  const { t } = useTranslation("statusbar");
  const active = useFileLoadStore((s) => s.active);
  const sizeBytes = useFileLoadStore((s) => s.sizeBytes);

  if (!active) return null;

  return (
    <div className="status-file-load" role="status" aria-live="polite">
      <span className="status-file-load__spinner" aria-hidden="true" />
      <span className="status-file-load__label">
        {t("largeFile.opening", { size: formatFileSize(sizeBytes) })}
      </span>
    </div>
  );
}
