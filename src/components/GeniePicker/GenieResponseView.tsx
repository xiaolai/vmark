/**
 * GenieResponseView — Inline AI response display
 *
 * Purpose: Renders the AI response area within the GeniePicker overlay.
 * Shows thinking/streaming state during processing, response text with
 * accept/reject/retry actions in preview mode, and error state with retry.
 *
 * @module components/GeniePicker/GenieResponseView
 */

import { AlertTriangle, Check, RotateCcw, Sparkles, X } from "lucide-react";
import type { PickerMode } from "@/stores/geniePickerStore";
import "./GenieResponseView.css";

interface GenieResponseViewProps {
  mode: PickerMode;
  responseText: string;
  elapsedSeconds: number;
  error: string | null;
  submittedPrompt: string | null;
  onAccept: () => void;
  onReject: () => void;
  onRetry: () => void;
  onCancel: () => void;
}

export function GenieResponseView({
  mode,
  responseText,
  elapsedSeconds,
  error,
  submittedPrompt,
  onAccept,
  onReject,
  onRetry,
  onCancel,
}: GenieResponseViewProps) {
  if (mode === "search" || mode === "freeform") return null;

  if (mode === "processing") {
    return (
      <div className="genie-response-view">
        {submittedPrompt && (
          <div className="genie-response-prompt">{submittedPrompt}</div>
        )}
        {responseText ? (
          <div className="genie-response-text">
            {responseText}
            <span className="genie-response-cursor" />
          </div>
        ) : (
          <div className="genie-response-thinking">
            <Sparkles size={14} className="genie-response-spinner" />
            <span>Thinking... {elapsedSeconds}s</span>
          </div>
        )}
        <div className="genie-response-actions">
          <button
            className="genie-response-btn genie-response-btn--reject"
            onClick={onCancel}
            aria-label="Cancel"
          >
            <X size={12} />
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (mode === "error") {
    return (
      <div className="genie-response-view">
        <div className="genie-response-error">
          <AlertTriangle size={14} />
          <span>{error ?? "Unknown error"}</span>
        </div>
        <div className="genie-response-actions">
          <button
            className="genie-response-btn genie-response-btn--retry"
            onClick={onRetry}
            aria-label="Retry"
          >
            <RotateCcw size={12} />
            Retry
          </button>
          <button
            className="genie-response-btn genie-response-btn--reject"
            onClick={onReject}
            aria-label="Dismiss"
          >
            <X size={12} />
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  // mode === "preview"
  return (
    <div className="genie-response-view">
      {responseText && (
        <div className="genie-response-text">{responseText}</div>
      )}
      <div className="genie-response-actions">
        <button
          className="genie-response-btn genie-response-btn--accept"
          onClick={onAccept}
          aria-label="Accept"
        >
          <Check size={12} />
          Accept
        </button>
        <button
          className="genie-response-btn genie-response-btn--reject"
          onClick={onReject}
          aria-label="Reject"
        >
          <X size={12} />
          Reject
        </button>
        <button
          className="genie-response-btn genie-response-btn--retry"
          onClick={onRetry}
          aria-label="Retry"
        >
          <RotateCcw size={12} />
          Retry
        </button>
      </div>
    </div>
  );
}
