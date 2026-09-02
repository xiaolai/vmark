/**
 * Purpose: render one AI provider's row in the Integrations panel — its status
 *   icon, name, config path, and the buttons its diagnostic permits.
 *
 * Split out of `McpConfigInstaller.tsx` when the legacy-provider badge pushed
 * that file over the 300-line gate. The row is presentational: every action is
 * a callback, and which buttons exist is decided by `rowActions` rather than
 * here, so the button policy stays testable without rendering.
 *
 * @coordinates-with src/pages/settings/mcpConfigMessages.ts — rowActions, diagnosticMessage
 * @coordinates-with src/pages/settings/McpConfigInstaller.tsx — the only caller
 * @module pages/settings/McpProviderRow
 */

import { useTranslation } from "react-i18next";
import { Button, CopyButton } from "./components";
import { getFileName } from "@/utils/paths";
import { DiagnosticIcon } from "./DiagnosticIcon";
import {
  diagnosticMessage,
  formatPath,
  rowActions,
  type ProviderDiagnostic,
} from "./mcpConfigMessages";

/** Shorten path to just filename for display */
function shortenPath(path: string): string {
  return getFileName(path) || path;
}

interface ProviderRowProps {
  diagnostic: ProviderDiagnostic;
  onPreview: () => void;
  onRepair: () => void;
  onUninstall: () => void;
  onRecheck: () => void;
  loading: boolean;
}

export function ProviderRow(props: ProviderRowProps) {
  const { diagnostic, onPreview, onRepair, onUninstall, onRecheck, loading } = props;
  const { t } = useTranslation("settings");
  const actions = rowActions(diagnostic);
  const broken = diagnostic.status === "ConfigUnreadable";

  const diagnosticText = diagnosticMessage(diagnostic, t);

  return (
    <div className="flex flex-col py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <DiagnosticIcon status={diagnostic.status} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-medium text-[var(--text-color)] truncate">
                {diagnostic.name}
              </span>
              {diagnostic.legacy && (
                <span className="text-xs px-1.5 py-0.5 rounded-sm font-medium bg-[var(--warning-bg)] text-[var(--warning-color)] flex-shrink-0">
                  {t("integrations.installMcp.legacyBadge")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <span
                className="text-xs text-[var(--text-secondary)] font-mono truncate"
                title={formatPath(diagnostic.configPath)}
              >
                {shortenPath(diagnostic.configPath)}
              </span>
              <CopyButton text={diagnostic.configPath} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-3">
          {actions.repair && (
            <Button size="sm" variant="warning" onClick={onRepair} disabled={loading}>
              {t("integrations.installMcp.repair")}
            </Button>
          )}
          {actions.update && (
            <Button size="sm" onClick={onPreview} disabled={loading}>
              {t("integrations.installMcp.update")}
            </Button>
          )}
          {actions.remove && (
            <Button size="sm" variant="danger" onClick={onUninstall} disabled={loading}>
              {t("integrations.installMcp.remove")}
            </Button>
          )}
          {actions.install && (
            <Button size="sm" variant="primary" onClick={onPreview} disabled={loading}>
              {t("integrations.installMcp.install")}
            </Button>
          )}
          {actions.recheck && (
            <Button size="sm" onClick={onRecheck} disabled={loading}>
              {t("integrations.installMcp.recheck")}
            </Button>
          )}
        </div>
      </div>
      {diagnosticText && (
        <div
          className={`mt-1 ml-6.5 text-xs ${
            broken ? "text-[var(--error-color)]" : "text-[var(--warning-color)]"
          }`}
        >
          {diagnosticText}
        </div>
      )}
    </div>
  );
}
