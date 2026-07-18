/**
 * English locale namespaces for the test i18n mock (split from setup.ts
 * for the file-size gate). Add new namespaces here when a component
 * starts using a new `useTranslation("<ns>")`.
 */
import commonEn from "../locales/en/common.json";
import menuEn from "../locales/en/menu.json";
import statusbarEn from "../locales/en/statusbar.json";
import sidebarEn from "../locales/en/sidebar.json";
import settingsEn from "../locales/en/settings.json";
import aiEn from "../locales/en/ai.json";
import editorEn from "../locales/en/editor.json";
import dialogEn from "../locales/en/dialog.json";
import exportEn from "../locales/en/export.json";
import workflowEditorEn from "../locales/en/workflowEditor.json";
import breakdownEn from "../locales/en/breakdown.json";
import claimsEn from "../locales/en/claims.json";

export const localeMap: Record<string, Record<string, unknown>> = {
  common: commonEn as Record<string, unknown>,
  menu: menuEn as Record<string, unknown>,
  statusbar: statusbarEn as Record<string, unknown>,
  sidebar: sidebarEn as Record<string, unknown>,
  settings: settingsEn as Record<string, unknown>,
  ai: aiEn as Record<string, unknown>,
  editor: editorEn as Record<string, unknown>,
  dialog: dialogEn as Record<string, unknown>,
  export: exportEn as Record<string, unknown>,
  workflowEditor: workflowEditorEn as Record<string, unknown>,
  breakdown: breakdownEn as Record<string, unknown>,
  claims: claimsEn as Record<string, unknown>,
};
