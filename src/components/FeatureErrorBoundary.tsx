/**
 * Feature Error Boundary
 *
 * Purpose: Localized React error boundary for crash-prone subtrees
 *   (Editor, Terminal, PDF export route). Lets a single feature fail
 *   without unmounting the surrounding application chrome — the user
 *   keeps their sidebar, tabs, status bar, and can save / switch tabs.
 *
 * Difference from App.tsx root ErrorBoundary: the root catches anything
 * the inner boundaries missed and shows a full-page error. These inner
 * boundaries show a small inline fallback so the rest of the window
 * keeps working.
 *
 * @module components/FeatureErrorBoundary
 */

import { Component, type ReactNode } from "react";
import { withTranslation, type WithTranslation } from "react-i18next";
import { appError } from "@/utils/debug";

interface OwnProps {
  /** Human-readable feature label shown in the fallback message. */
  feature: string;
  /** Children to render unless an error is caught. */
  children: ReactNode;
  /**
   * Optional custom fallback. When omitted, a small inline error card is
   * rendered. The render prop receives the captured error and a `reset`
   * callback for retry UI; the default fallback wires `reset` to a button.
   */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

type Props = OwnProps & WithTranslation<"dialog">;

interface State {
  error: Error | null;
}

class FeatureErrorBoundaryInner extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    appError(`[FeatureErrorBoundary:${this.props.feature}]`, error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) {
        return this.props.fallback(error, this.reset);
      }
      const { t } = this.props;
      return (
        <div
          role="alert"
          style={{
            padding: 20,
            margin: 16,
            border: `${1}px solid var(--error-color)`,
            borderRadius: "var(--radius-md)",
            background: "var(--error-bg)",
            color: "var(--text-color)",
            fontSize: 13,
            fontFamily: "var(--font-sans)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8, color: "var(--error-color)" }}>
            {t("errorBoundary.featureFailedTitle", { feature: this.props.feature })}
          </div>
          <pre
            style={{
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              opacity: 0.85,
              margin: 0,
              marginBottom: 12,
            }}
          >
            {error.message}
          </pre>
          <button
            type="button"
            onClick={this.reset}
            style={{
              padding: `${4}px ${12}px`,
              border: `${1}px solid var(--border-color)`,
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-color)",
              color: "var(--text-color)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {t("errorBoundary.tryAgain")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export const FeatureErrorBoundary = withTranslation("dialog")(FeatureErrorBoundaryInner);
