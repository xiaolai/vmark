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

import { registerCommand } from "./CommandBus";
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

/** Write (or clear, when formatId is null) one association, preserving the rest. */
function setAssociation(key: string, formatId: string | null): void {
  const current = useSettingsStore.getState().formats.associations ?? {};
  const next = { ...current };
  if (formatId === null) {
    delete next[key];
  } else {
    next[key] = formatId;
  }
  useSettingsStore.getState().updateFormatsSetting("associations", next);
}

let registered = false;
export function registerFormatCommands(): void {
  if (registered) return;

  registerCommand({
    id: "format.setPlainText",
    title: () => i18n.t("commands:format.setPlainText"),
    category: "format",
    when: (ctx: Ctx) => activeKey(ctx) !== null,
    run: (_args, ctx: Ctx) => {
      const key = activeKey(ctx);
      if (!key) return;
      setAssociation(key, "txt");
      toast.info(i18n.t("commands:format.toast.set", { key, format: formatName("txt") }));
    },
  });

  registerCommand({
    id: "format.setMarkdown",
    title: () => i18n.t("commands:format.setMarkdown"),
    category: "format",
    when: (ctx: Ctx) => activeKey(ctx) !== null,
    run: (_args, ctx: Ctx) => {
      const key = activeKey(ctx);
      if (!key) return;
      setAssociation(key, "markdown");
      toast.info(i18n.t("commands:format.toast.set", { key, format: formatName("markdown") }));
    },
  });

  registerCommand({
    id: "format.resetType",
    title: () => i18n.t("commands:format.resetType"),
    category: "format",
    when: (ctx: Ctx) => activeKey(ctx) !== null,
    run: (_args, ctx: Ctx) => {
      const key = activeKey(ctx);
      if (!key) return;
      setAssociation(key, null);
      toast.info(i18n.t("commands:format.toast.reset", { key }));
    },
  });

  registered = true;
}

/** Test-only — reset the idempotency latch so each test re-registers. */
export function __resetFormatCommandsRegistration(): void {
  registered = false;
}
