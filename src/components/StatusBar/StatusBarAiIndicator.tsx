/**
 * StatusBarAiIndicator
 *
 * Purpose: the AI status trio (running / error / success) in the status bar's
 * right cluster. Extracted from StatusBarRight.tsx when the WI-UA11 grouping
 * work approached that file's 300-line ceiling.
 *
 * Key decisions:
 *   - All three states are role="status" aria-live="polite" so screen readers
 *     hear AI start/error/done. Running's per-second elapsed text is
 *     aria-hidden with a static sr-only sibling carrying the announcement, so
 *     the live region content stays stable across ticks and SR users aren't
 *     spammed every second.
 *   - Styles stay in StatusBar.css (`.status-ai-indicator*`) — one CSS file
 *     per surface, and the indicator is part of the status bar surface.
 *
 * @coordinates-with StatusBarRight.tsx — parent passes all props
 * @module components/StatusBar/StatusBarAiIndicator
 */
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Sparkles } from "lucide-react";
import { ICON_SM } from "@/utils/iconSizes";

interface StatusBarAiIndicatorProps {
  aiRunning: boolean;
  elapsedSeconds: number;
  aiError: string | null;
  showSuccess: boolean;
  onCancelAi: () => void;
  onRetryAi: () => void;
  onDismissError: () => void;
}

/** AI running/error/success indicator for the status bar right cluster. */
export function StatusBarAiIndicator({
  aiRunning,
  elapsedSeconds,
  aiError,
  showSuccess,
  onCancelAi,
  onRetryAi,
  onDismissError,
}: StatusBarAiIndicatorProps) {
  const { t } = useTranslation("statusbar");

  if (aiRunning) {
    return (
      // Live region announces ONLY the static "AI is working" message
      // once when the indicator mounts. The visible per-second elapsed
      // text is marked aria-hidden so screen readers don't get spammed
      // with "AI thinking 1s, AI thinking 2s, …" every second.
      <span
        className="status-ai-indicator status-ai-indicator--running"
        role="status"
        aria-live="polite"
        title={t("aiWorking")}
      >
        <Sparkles size={ICON_SM} className="status-ai-spinner" />
        <span className="sr-only">{t("aiWorking")}</span>
        <span className="status-ai-text" aria-hidden="true">
          {elapsedSeconds < 10
            ? t("aiThinking", { seconds: elapsedSeconds })
            : t("aiStillWorking", { seconds: elapsedSeconds })}
        </span>
        <button
          className="status-ai-cancel"
          onClick={onCancelAi}
          title={t("cancelAiTitle")}
          aria-label={t("cancelAiRequest")}
        >
          ×
        </button>
      </span>
    );
  }

  if (aiError) {
    return (
      <span
        className="status-ai-indicator status-ai-indicator--error"
        role="status"
        aria-live="polite"
        title={aiError}
      >
        <AlertTriangle size={ICON_SM} />
        <span className="status-ai-text">
          {aiError.length > 30 ? `${aiError.slice(0, 30)}…` : aiError}
        </span>
        <button className="status-ai-action" onClick={onRetryAi}>{t("aiRetry")}</button>
        <button
          className="status-ai-cancel"
          onClick={onDismissError}
          title={t("dismissTitle")}
          aria-label={t("dismissError")}
        >
          ×
        </button>
      </span>
    );
  }

  if (showSuccess) {
    return (
      <span
        className="status-ai-indicator status-ai-indicator--success"
        role="status"
        aria-live="polite"
      >
        <Check size={ICON_SM} />
        <span className="status-ai-text">{t("aiDone")}</span>
      </span>
    );
  }

  return null;
}
