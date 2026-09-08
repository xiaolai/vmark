/**
 * Format-override commands — the "Set File Type" escape hatch (ADR:
 * "markdown is an allowlist, not a default").
 *
 * Three palette commands let the user override how a file family opens:
 *   - format.setPlainText — open these files as plain text (the fix for
 *     "stop treating my .env as markdown").
 *   - format.setMarkdown  — render these files with the markdown editor.
 *   - format.resetType    — drop the override, back to the built-in rule.
 *
 * Each persists a per-key association in `settings.formats.associations`
 * (keyed via `associationKey`, so `.env.local` overrides the whole `.env`
 * family). The format-settings bridge observes the change and recomputes
 * every open tab's formatId, remounting the editor.
 *
 * @coordinates-with lib/formats/registry.ts — associationKey
 * @coordinates-with services/formats/formatSettingsBridge.ts — recompute on change
 * @module services/commands/formatCommands
 */

import { registerCommands, type CommandDefinition } from "./CommandBus";
import { useSettingsStore } from "@/stores/settingsStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getActiveTabId } from "@/services/navigation/activeDocument";
import { associationKey, getFormatById } from "@/lib/formats";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";

type Ctx = { windowLabel?: string };

/** Localized display name for a format id, falling back to the id. */
function formatName(formatId: string): string {
  const cfg = getFormatById(formatId);
  if (!cfg) return formatId;
  const key = `common:${cfg.nameI18nKey}`;
  const name = i18n.t(key);
  return name && name !== key ? name : formatId;
}

/** The active document's file path, or null for untitled / no active tab. */
function activeFilePath(ctx: Ctx): string | null {
  const windowLabel = ctx.windowLabel ?? "main";
  const tabId = getActiveTabId(windowLabel);
  if (!tabId) return null;
  return useDocumentStore.getState().getDocument(tabId)?.filePath ?? null;
}

/** The association key for the active file, or null when none applies. */
function activeKey(ctx: Ctx): string | null {
  const filePath = activeFilePath(ctx);
  return filePath ? associationKey(filePath) : null;
}

/** Write (or clear, when formatId is null) one association, preserving the rest.
 *  Early-returns when nothing semantically changes — a no-op assignment would
 *  still trigger `recomputeAllFormatIds()` for every open tab via the
 *  bridge's reference comparison. */
function setAssociation(key: string, formatId: string | null): boolean {
  const current = useSettingsStore.getState().formats.associations ?? {};
  if (formatId === null) {
    if (!(key in current)) return false;
  } else {
    if (current[key] === formatId) return false;
  }
  const next = { ...current };
  if (formatId === null) {
    delete next[key];
  } else {
    next[key] = formatId;
  }
  useSettingsStore.getState().updateFormatsSetting("associations", next);
  return true;
}

/** The three override commands differ only in target format (null = reset). */
const OVERRIDE_COMMANDS = [
  { id: "format.setPlainText", formatId: "txt" },
  { id: "format.setMarkdown", formatId: "markdown" },
  { id: "format.resetType", formatId: null },
] as const;

/** Owner token this batch registers under (HMR-safe, atomic — see viewCommands). */
const FORMAT_COMMANDS_OWNER = "format-commands";

/** Build the three override command specs (pure — no registration). */
function buildFormatCommandSpecs(): CommandDefinition[] {
  return OVERRIDE_COMMANDS.map(({ id, formatId }) => ({
    id,
    title: () => i18n.t(`commands:${id}`),
    category: "format",
    when: (ctx: Ctx) => activeKey(ctx) !== null,
    run: (_args: unknown, ctx: Ctx) => {
      const key = activeKey(ctx);
      if (!key) return;
      if (!setAssociation(key, formatId)) return;
      toast.info(
        formatId === null
          ? i18n.t("commands:format.toast.reset", { key })
          : i18n.t("commands:format.toast.set", { key, format: formatName(formatId) }),
      );
    },
  }));
}

/**
 * Register the three override commands as ONE owner batch (audit #906).
 *
 * Checking only the first id could not detect foreign ownership, and a
 * `registerCommand` that threw part-way left an incomplete batch that every
 * later retry skipped. `registerCommands` preflights all three and replaces
 * its own previous batch (#459).
 */
export function registerFormatCommands(): void {
  registerCommands(FORMAT_COMMANDS_OWNER, buildFormatCommandSpecs());
}
