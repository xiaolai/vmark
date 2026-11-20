/**
 * Resolve an explicitly requested Windows interpreter without a wrong-shell fallback.
 * @module components/Terminal/windowsCodeBlockShell
 */
import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";

export async function resolveWindowsCodeBlockShell(kind: "powershell" | "cmd" | "python"): Promise<string> {
  const available = await invoke<string[]>("list_available_shells");
  const executable = kind === "cmd" ? "cmd.exe" : "powershell.exe";
  const shell = available.find(path => path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() === executable);
  if (shell && /^[a-z]:[/\\]/i.test(shell)) return shell;
  await i18n.loadNamespaces("settings");
  throw new Error(i18n.t("settings:terminal.shell.unavailable", { name: kind === "cmd" ? "CMD" : "PowerShell" }));
}
