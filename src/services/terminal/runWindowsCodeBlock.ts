/**
 * Execute Windows code blocks in dedicated INTERNAL terminal sessions.
 * Source stays pinned to the newly created session until its PTY accepts it.
 * @module services/terminal/runWindowsCodeBlock
 */
import { useTerminalStore } from "@/stores/terminalStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { getActiveWorkspaceScope } from "@/services/workspaces/activeWorkspaceScope";
import { getParentDir } from "@/utils/paths/paths";
import { createTerminalSessionInScope } from "./createTerminalSession";
import { revealTerminalSession } from "./revealTerminalSession";
import type { RunInTerminalResult } from "./runInTerminal";

export function windowsCodeBlockShell(language: string): "powershell" | "cmd" | "python" | null {
  switch (language.trim().toLowerCase()) {
    case "powershell": case "ps1": return "powershell";
    case "cmd": case "bat": case "batch": case "dos": return "cmd";
    case "python": case "py": case "python3": return "python";
    default: return null;
  }
}

function workingDirectory(): string | undefined {
  const windowLabel = getCurrentWindowLabel();
  const tabId = useTabStore.getState().activeTabId[windowLabel];
  const filePath = tabId ? useDocumentStore.getState().getDocument(tabId)?.filePath : undefined;
  if (filePath) {
    const parent = getParentDir(filePath);
    if (parent) return /^[a-z]:$/i.test(parent) ? `${parent}/` : parent;
    const drive = /^([a-z]):[/\\]/i.exec(filePath);
    if (drive) return `${drive[1].toLowerCase()}:/`;
  }
  return getActiveWorkspaceScope(windowLabel).rootPath ?? undefined;
}

export async function runWindowsCodeBlock(source: string, language: string): Promise<RunInTerminalResult> {
  const shell = windowsCodeBlockShell(language);
  if (!shell) return { ok: false, reason: "not-shell" };
  if (!source.trim()) return { ok: false, reason: "empty" };
  const cwd = workingDirectory();
  const created = createTerminalSessionInScope(getCurrentWindowLabel(), {
    windowsShell: shell, pendingCode: source, ...(cwd !== undefined ? { requestedCwd: cwd } : {}),
  });
  if (!created) return { ok: false, reason: "max-sessions" };
  revealTerminalSession(created.id);
  return new Promise((resolve) => {
    let finished = false;
    const finish = (ok: boolean): void => {
      if (finished) return;
      finished = true;
      unsubscribe();
      clearTimeout(timer);
      resolve(ok ? { ok: true } : { ok: false, reason: "launch-failed" });
    };
    const check = (): void => {
      const session = useTerminalStore.getState().sessions.find(item => item.id === created.id);
      if (!session || !session.isAlive) finish(false);
      else if (session.pendingCode === undefined) finish(true);
    };
    const unsubscribe = useTerminalStore.subscribe(check);
    const timer = setTimeout(() => {
      finish(false);
      useTerminalStore.getState().terminalRemoveSession(created.id);
    }, 30_000);
    check();
  });
}
