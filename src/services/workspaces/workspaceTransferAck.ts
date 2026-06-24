import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { WorkspaceTransferAckPayload } from "@/types/workspaceTransfer";

export async function waitForWorkspaceAck(
  requestId: string,
  timeoutMs: number,
): Promise<WorkspaceTransferAckPayload | null> {
  const currentWindow = getCurrentWebviewWindow();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unlisten: (() => void) | null = null;

  return new Promise((resolve) => {
    const finish = (value: WorkspaceTransferAckPayload | null) => {
      if (timer) clearTimeout(timer);
      unlisten?.();
      resolve(value);
    };

    timer = setTimeout(() => finish(null), timeoutMs);
    currentWindow.listen<WorkspaceTransferAckPayload>("workspace:transfer-ack", (event) => {
      if (event.payload.requestId !== requestId) return;
      finish(event.payload);
    }).then((fn) => {
      unlisten = fn;
    }).catch(() => finish(null));
  });
}
