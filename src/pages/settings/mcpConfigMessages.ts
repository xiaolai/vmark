/**
 * Purpose: derive the Integrations panel's MCP status text and per-row action
 *   set from the backend's machine-readable fields, rather than echoing the
 *   prose it also sends.
 *
 * `mcp_config`'s Rust commands return both a `DiagnosticStatus` enum and a
 * `message` string built from it. The message therefore carries no information
 * the enum doesn't — and it arrives in English whatever the UI language is,
 * because the backend builds it before the frontend's locale is in play.
 * Deriving here keeps user-facing text in the layer that owns the UI language,
 * and matches what the repair path in `McpConfigInstaller.tsx` already did with
 * `installMcp.repairSuccess`. The one exception is `ConfigUnreadable`, whose
 * `message` is a parse/IO detail (localized Rust-side via `errors.mcp.*`) that
 * the frontend cannot reconstruct — it is interpolated, not replaced.
 *
 * `legacy` is a SECOND dimension, orthogonal to `status`: it marks a provider
 * VMark no longer targets (Gemini CLI), whose row exists only to remove a
 * leftover entry. It short-circuits both functions here, because a
 * discontinued tool's row offers the same one action and the same advice
 * whatever its config happens to say.
 *
 * Kept out of the component file so the derivation can grow without pushing
 * `McpConfigInstaller.tsx` back over the 300-line limit; the row markup itself
 * lives in `McpProviderRow.tsx` for the same reason.
 *
 * @coordinates-with src-tauri/src/mcp_config/commands.rs — builds the prose these replace
 * @coordinates-with src-tauri/src/mcp_config/types.rs — DiagnosticStatus, ProviderDiagnostic.legacy, UninstallResult.changed
 * @coordinates-with src/pages/settings/McpProviderRow.tsx — the sole consumer of rowActions
 * @module pages/settings/mcpConfigMessages
 */

import type { TFunction } from "i18next";
import { normalizePath } from "@/utils/paths";
import type { DiagnosticStatus } from "./DiagnosticIcon";

/** One provider's diagnostic — mirrors `ProviderDiagnostic` in types.rs. */
export interface ProviderDiagnostic {
  provider: string;
  name: string;
  /** A discontinued tool. The backend lists it only while a vmark entry is
   * still in its config; the row offers removal and nothing else. */
  legacy: boolean;
  configPath: string;
  configExists: boolean;
  hasVmark: boolean;
  expectedBinaryPath: string | null;
  configuredBinaryPath: string | null;
  binaryExists: boolean;
  status: DiagnosticStatus;
  message: string;
}

/** Format a path for display: replace the user's home directory with `~`. */
export function formatPath(path: string): string {
  const normalized = normalizePath(path);
  // Shorten home paths: macOS /Users/x, Windows C:/Users/x, Linux /home/x → ~
  return normalized
    .replace(/^\/Users\/[^/]+/, "~")
    .replace(/^[A-Za-z]:\/Users\/[^/]+/, "~")
    .replace(/^\/home\/[^/]+/, "~");
}

/** Which buttons a provider row offers. */
export interface RowActions {
  repair: boolean;
  update: boolean;
  remove: boolean;
  install: boolean;
  recheck: boolean;
}

/**
 * Decide a row's buttons from its diagnostic.
 *
 * `ConfigUnreadable` offers **no** config-writing action. `hasVmark` is `false`
 * there because the answer is unknown, not because the entry is absent — and
 * the old `showInstall = !hasVmark` turned that unknown into an Install button
 * pointed at a file the install path refuses to parse. Recheck replaces it:
 * the fix happens in the user's editor, and this re-runs the diagnosis.
 *
 * A legacy row exists only to be removed: Install/Update/Repair would write a
 * fresh entry into the config of a discontinued tool, and the backend refuses
 * them anyway.
 */
export function rowActions(
  diagnostic: Pick<ProviderDiagnostic, "status" | "hasVmark" | "legacy">,
): RowActions {
  if (diagnostic.status === "ConfigUnreadable") {
    return { repair: false, update: false, remove: false, install: false, recheck: true };
  }
  if (diagnostic.legacy) {
    return { repair: false, update: false, remove: true, install: false, recheck: false };
  }
  const mismatch = diagnostic.status === "PathMismatch";
  return {
    repair: mismatch,
    update: mismatch || diagnostic.hasVmark,
    remove: mismatch || diagnostic.hasVmark,
    install: !diagnostic.hasVmark,
    recheck: false,
  };
}

/**
 * Localized warning for a provider row, or `""` when there is nothing to say.
 *
 * The backend's own `message` is used for `ConfigUnreadable` (as the `detail`
 * of a localized sentence) and as a fallback for a status this function does
 * not recognise — so a future enum variant still shows something rather than
 * silently rendering blank.
 */
export function diagnosticMessage(
  diagnostic: Pick<ProviderDiagnostic, "status" | "message" | "configPath" | "legacy">,
  t: TFunction<"settings">,
): string {
  // A legacy row is present precisely because there is something to remove;
  // whatever else its status says, the advice is the same.
  if (diagnostic.legacy) {
    return t("integrations.installMcp.legacyHint");
  }
  switch (diagnostic.status) {
    case "BinaryMissing":
      return t("integrations.installMcp.statusBinaryMissing");
    case "PathMismatch":
      return t("integrations.installMcp.statusPathMismatch");
    case "ConfigUnreadable":
      return t("integrations.installMcp.statusConfigUnreadable", {
        path: formatPath(diagnostic.configPath),
        detail: diagnostic.message,
      });
    case "Valid":
    case "NotConfigured":
      return "";
    default:
      return diagnostic.message || "";
  }
}

/**
 * Localized outcome for a successful uninstall.
 *
 * `changed` is the reason `UninstallResult` carries that field at all: the
 * distinction between "removed it" and "there was nothing to remove" existed
 * only inside the English sentence until it was exposed as data.
 */
export function uninstallMessage(changed: boolean, t: TFunction<"settings">): string {
  return changed
    ? t("integrations.installMcp.removeSuccess")
    : t("integrations.installMcp.removeNothingToDo");
}

/** Localized outcome for a successful install. */
export function installMessage(provider: string, t: TFunction<"settings">): string {
  return t("integrations.installMcp.installSuccess", { provider });
}

/** Result of `mcp_config_install` — mirrors `InstallResult` in types.rs. */
export interface InstallResult {
  success: boolean;
  message: string;
  backupPath: string | null;
}

/** Result of `mcp_config_uninstall` — mirrors `UninstallResult` in types.rs. */
export interface UninstallResult {
  success: boolean;
  message: string;
  /** True when an entry was actually removed; false when there was none. */
  changed: boolean;
}
