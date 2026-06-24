/**
 * Document Tools Settings (Pandoc)
 *
 * Detects Pandoc availability and surfaces version / path / install hints.
 * Split out of FilesImagesSettings to keep that module a thin composition.
 *
 * Race handling: each detect() call gets a monotonically increasing request
 * id. Only the latest request is allowed to mutate state, so a slow earlier
 * detection can never overwrite a newer result or clear `detecting` while a
 * fresher refresh is still in flight.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { SettingRow, SettingsGroup } from "./components";
import { rebuildNativeMenu } from "@/services/menu/rebuildNativeMenu";
import { RefreshCw, ExternalLink } from "lucide-react";
import { errorMessage } from "@/utils/errorMessage";

interface PandocInfo {
  available: boolean;
  path: string | null;
  version: string | null;
}

export function DocumentToolsSettings() {
  const { t } = useTranslation("settings");
  const [pandoc, setPandoc] = useState<PandocInfo | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // Monotonic request id — only the latest request may mutate state.
  const requestIdRef = useRef(0);

  const detect = useCallback(async (refreshMenu: boolean) => {
    const requestId = ++requestIdRef.current;
    // Ignore this request's mutations once a newer detect() has started.
    const isStale = () => !mountedRef.current || requestIdRef.current !== requestId;

    setDetecting(true);
    setDetectError(null);
    try {
      const info = await invoke<PandocInfo>("detect_pandoc");
      if (isStale()) return;
      setPandoc(info);
      if (refreshMenu) {
        // Menu rebuild is a side effect of detection — surface any failure
        // but keep the just-detected pandoc state.
        try {
          await rebuildNativeMenu();
        } catch (err) {
          if (!isStale()) {
            setDetectError(errorMessage(err));
          }
        }
      }
    } catch (err) {
      if (isStale()) return;
      setPandoc(null);
      setDetectError(errorMessage(err));
    } finally {
      if (!isStale()) setDetecting(false);
    }
  }, []);

  // Auto-detect on mount (no menu refresh — menu was built with correct state at startup).
  useEffect(() => {
    void detect(false);
    return () => { mountedRef.current = false; };
  }, [detect]);

  return (
    <SettingsGroup title={t("files.group.documentTools")}>
      <SettingRow
        label={t("files.pandoc.label")}
        description={t("files.pandoc.description")}
      >
        <div className="flex items-center gap-3">
          {pandoc && (
            <span
              className={`text-xs ${
                pandoc.available
                  ? "text-[var(--success-color)]"
                  : "text-[var(--text-tertiary)]"
              }`}
            >
              {pandoc.available
                ? `v${pandoc.version ?? "unknown"}`
                : t("files.pandoc.notFound")}
            </span>
          )}
          <button
            onClick={() => { void detect(true); }}
            disabled={detecting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md
              bg-[var(--bg-tertiary)] text-[var(--text-secondary)]
              hover:bg-[var(--hover-bg-strong)] hover:text-[var(--text-color)]
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors"
          >
            <RefreshCw size={12} className={detecting ? "animate-spin" : ""} />
            {t("files.pandoc.detect")}
          </button>
        </div>
      </SettingRow>

      {detectError && (
        <div className="text-xs text-[var(--error-color)] mt-1 px-1">
          {t("files.pandoc.detectionFailed", { error: detectError })}
        </div>
      )}

      {pandoc && !pandoc.available && (
        <div className="text-xs text-[var(--text-tertiary)] mt-1 px-1">
          {t("files.pandoc.installHint")}{" "}
          <a
            href="https://pandoc.org/installing.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--primary-color)] hover:underline inline-flex items-center gap-0.5"
          >
            {t("files.pandoc.installGuide")}
            <ExternalLink size={10} />
          </a>
        </div>
      )}

      {pandoc?.available && pandoc.path && (
        <div className="mt-2 px-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--text-tertiary)]">{t("files.pandoc.path")}</span>
            <code className="text-[var(--text-secondary)] font-mono text-[11px]">
              {pandoc.path}
            </code>
          </div>
        </div>
      )}
    </SettingsGroup>
  );
}
