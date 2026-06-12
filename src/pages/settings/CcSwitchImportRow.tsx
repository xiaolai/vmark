/**
 * CC-Switch import row (issue #1008).
 *
 * One-click hand-off of VMark's MCP server to CC-Switch via a
 * `ccswitch://v1/import` deep link. Extracted from McpConfigInstaller so
 * that baselined file stays under its size limit (audit 20260612 gate).
 */

import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { Button, CopyButton } from "./components";
import { buildCcSwitchImportLink } from "@/utils/ccswitchLink";
import { imeToast as toast } from "@/services/ime/imeToast";

interface CcSwitchImportRowProps {
  /** Absolute path to VMark's MCP sidecar binary, or null if unresolved. */
  binaryPath: string | null;
  loading: boolean;
}

export function CcSwitchImportRow({ binaryPath, loading }: CcSwitchImportRowProps) {
  const { t } = useTranslation("settings");
  const link = binaryPath ? buildCcSwitchImportLink(binaryPath) : null;

  const handleAdd = async () => {
    if (!link) return;
    try {
      // App-generated, trusted link — opened directly via the OS opener (not
      // the document-link allowlist, which constrains untrusted document
      // content). If CC-Switch isn't installed, the OS handles it.
      await openUrl(link);
      toast.success(t("integrations.ccSwitch.opened"));
    } catch (err) {
      toast.error(String(err));
    }
  };

  return (
    <div className="flex items-center justify-between py-2.5 border-t border-[var(--border-color)]">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[var(--text-color)]">
          {t("integrations.ccSwitch.label")}
        </div>
        <div className="text-xs text-[var(--text-tertiary)]">
          {link
            ? t("integrations.ccSwitch.description")
            : t("integrations.ccSwitch.binaryMissing")}
        </div>
      </div>
      <div className="flex items-center gap-2 ml-3">
        {link && <CopyButton text={link} size="xs" />}
        <Button
          size="sm"
          variant="primary"
          onClick={handleAdd}
          disabled={loading || !link}
        >
          {t("integrations.ccSwitch.add")}
        </Button>
      </div>
    </div>
  );
}
