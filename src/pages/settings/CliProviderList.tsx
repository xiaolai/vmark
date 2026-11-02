/**
 * CLI Provider List — the detected CLI rows in Settings > Integrations, and the
 * notice that separates "this CLI is not installed" from "VMark could not read
 * your shell's PATH".
 *
 * Key decisions:
 *   - The notice is re-read after each scan rather than pushed: a scan is what
 *     can change the backend's answer, and `detecting` marks its end.
 *   - It shows only while a CLI is missing. A fallback PATH that still finds
 *     every CLI has nothing to explain.
 *
 * @coordinates-with src-tauri/src/ai_provider/login_path.rs — owns the fallback state
 * @module pages/settings/CliProviderList
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import { useAiProviderStore } from "@/stores/aiStore";
import { commandErrorMessage } from "@/services/commands/commandError";
import { aiProviderWarn } from "@/utils/debug";
import { ProviderRadio } from "./ProviderRadio";

type ProbeReason = "spawn" | "exit" | "timeout" | "noPath";

/** Mirrors `LoginPathFallback` in `login_path.rs`. */
interface LoginPathFallback {
  shell: string;
  reason: ProbeReason;
  path: string;
}

/** The fallback as of the last finished scan; `null` when none is in effect. */
function useLoginPathFallback(): LoginPathFallback | null {
  const detecting = useAiProviderStore((s) => s.detecting);
  const [fallback, setFallback] = useState<LoginPathFallback | null>(null);

  useEffect(() => {
    if (detecting) return;
    let stale = false;
    void invoke<LoginPathFallback | null>("login_path_fallback")
      .then((value) => {
        if (!stale) setFallback(value ?? null);
      })
      .catch((error: unknown) => {
        aiProviderWarn("login_path_fallback failed:", commandErrorMessage(error));
        if (!stale) setFallback(null);
      });
    return () => {
      stale = true;
    };
  }, [detecting]);

  return fallback;
}

function CliPathNotice({ fallback }: { fallback: LoginPathFallback }) {
  const { t } = useTranslation("settings");
  const reasons: Record<ProbeReason, string> = {
    spawn: t("integrations.cliPath.reason.spawn"),
    exit: t("integrations.cliPath.reason.exit"),
    timeout: t("integrations.cliPath.reason.timeout"),
    noPath: t("integrations.cliPath.reason.noPath"),
  };

  return (
    <div role="status" className="mt-2 px-1 flex gap-1.5 text-xs text-[var(--text-secondary)]">
      <TriangleAlert size={14} aria-hidden className="shrink-0 text-[var(--warning-color)]" />
      <div className="min-w-0">
        <p>
          {t("integrations.cliPath.warning", { shell: fallback.shell, reason: reasons[fallback.reason] })}{" "}
          {t("integrations.cliPath.retry")}
        </p>
        {fallback.path && (
          <p className="mt-1">
            {t("integrations.cliPath.searched")}{" "}
            <code className="font-mono break-all">{fallback.path}</code>
          </p>
        )}
      </div>
    </div>
  );
}

export function CliProviderList() {
  const { t } = useTranslation("settings");
  const cliProviders = useAiProviderStore((s) => s.cliProviders);
  const activeProvider = useAiProviderStore((s) => s.activeProvider);
  const fallback = useLoginPathFallback();

  if (cliProviders.length === 0) return null;

  const activate = useAiProviderStore.getState().activateProvider;
  const someMissing = cliProviders.some((p) => !p.available);

  return (
    <>
      <div className="mt-2 px-1" role="radiogroup" aria-label={t("integrations.aiProviders.cliProviders")}>
        <div className="text-xs text-[var(--text-secondary)] mb-1">{t("integrations.aiProviders.cliProviders")}</div>
        {cliProviders.map((p) => (
          <div
            key={p.type}
            className={`flex items-center gap-2 text-xs py-1.5 ${
              !p.available ? "opacity-[var(--opacity-disabled)]" : "cursor-pointer"
            }`}
            onClick={() => p.available && activate(p.type)}
          >
            <ProviderRadio
              checked={activeProvider === p.type}
              disabled={!p.available}
              onChange={() => activate(p.type)}
              label={p.name}
            />
            <span className={
              activeProvider === p.type
                ? "text-[var(--text-color)] font-medium"
                : "text-[var(--text-secondary)]"
            }>
              {p.name}
            </span>
            <span
              className={`ml-auto text-xs ${
                p.available
                  ? "text-[var(--success-color)]"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              {p.available ? t("integrations.aiProviders.available") : t("integrations.aiProviders.notFound")}
            </span>
          </div>
        ))}
      </div>
      {fallback && someMissing && <CliPathNotice fallback={fallback} />}
    </>
  );
}
