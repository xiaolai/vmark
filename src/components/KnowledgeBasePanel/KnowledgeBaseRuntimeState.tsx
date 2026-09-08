/**
 * KnowledgeBaseRuntimeState (WI-FL1.1) — the stopped-state body of the
 * Knowledge Base panel: what a start would find, and the Start button only
 * when a start could succeed.
 *
 * One branch per `RuntimeProbe` phase, with `known` split by readiness:
 *   - checking → a status line and no Start yet (a click now would only
 *     reproduce the `not-found` the probe is about to explain);
 *   - failed → the reason, AND Start — the probe is advisory, so when it cannot
 *     run, the start path and its own error reporting take over;
 *   - known + ready → Start;
 *   - known + missing → an alert naming each missing half and what provides it,
 *     with "Check again" in place of Start.
 *
 * Copy is decided in `runtimeState.ts` (packaged vs development wording); this
 * component only renders keys.
 *
 * @coordinates-with ./runtimeState.ts — phases and key selection
 * @module components/KnowledgeBasePanel/KnowledgeBaseRuntimeState
 */
import { useTranslation } from "react-i18next";
import type { ContentServerRuntime } from "@/services/contentServer";
import { isRuntimeReady, runtimeMissingKeys, type RuntimeProbe } from "./runtimeState";

export interface KnowledgeBaseRuntimeStateProps {
  probe: RuntimeProbe;
  /**
   * Development wording for a missing CLI (env override / provisioned base-kb)
   * versus the packaged build's "not included in this build".
   */
  isDevBuild: boolean;
  onStart: () => void;
  onRecheck: () => void;
}

/** The Start button — rendered only by the phases in which a start could succeed. */
function StartButton({ onStart }: { onStart: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="vm-btn" onClick={onStart}>
      {t("contentServer.action.start")}
    </button>
  );
}

/** The alert for a runtime with a missing half: what is missing, what provides it, "Check again". */
function RuntimeMissing({
  runtime,
  isDevBuild,
  onRecheck,
}: {
  runtime: ContentServerRuntime;
  isDevBuild: boolean;
  onRecheck: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="kb-panel__runtime" role="alert" data-testid="kb-runtime-missing">
      <p>{t("contentServer.runtime.unavailable")}</p>
      <ul>
        {runtimeMissingKeys(runtime, isDevBuild).map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ul>
      <button type="button" className="vm-btn" onClick={onRecheck}>
        {t("contentServer.runtime.recheck")}
      </button>
    </div>
  );
}

export function KnowledgeBaseRuntimeState({
  probe,
  isDevBuild,
  onStart,
  onRecheck,
}: KnowledgeBaseRuntimeStateProps) {
  const { t } = useTranslation();
  switch (probe.phase) {
    case "checking":
      return (
        <p className="kb-panel__runtime-note" role="status">
          {t("contentServer.runtime.checking")}
        </p>
      );
    case "failed":
      return (
        <>
          <p className="kb-panel__runtime-note" role="status">
            {t("contentServer.runtime.probeFailed", { message: probe.message })}
          </p>
          <StartButton onStart={onStart} />
        </>
      );
    case "known":
      return isRuntimeReady(probe.runtime) ? (
        <StartButton onStart={onStart} />
      ) : (
        <RuntimeMissing runtime={probe.runtime} isDevBuild={isDevBuild} onRecheck={onRecheck} />
      );
    default:
      return exhausted(probe);
  }
}

/**
 * The switch above covers every `RuntimeProbe` phase, and this is what says so
 * (audit R3 #632). Without it a new phase COMPILES and renders nothing: the
 * panel loses its Start button with no error anywhere, which is the hardest
 * kind of regression to notice.
 *
 * It returns null rather than throwing. The compile error is the gate; a throw
 * here would only fire from untyped code, inside a render with no error
 * boundary above it, turning a missing button into a blank window.
 */
function exhausted(_phase: never): null {
  return null;
}
