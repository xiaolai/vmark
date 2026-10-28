// vmark.workspace.save_as to another spelling of the tab's own file
// (`/root/./a.md` for `/root/a.md`) is a save of that file, not a new
// location: no approval is asked with auto-approve off, and the existing file
// is written over, not published no-replace. (`..` is refused at the bridge's
// path check before this.) Real handler and save pipeline; the write itself is
// recorded, since the disk fake keys folders by spelling and a real disk does not.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", async () =>
  (await import("./bridgeWriteGate")).gatedFsModule(),
);
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./bridgeWriteGate")).gatedCoreModule(),
);

import { statefulFs } from "@/test/statefulFsFake";
import { ROOT, editDoc, openDocInTab } from "@/test/tier0/harness";
import { imeToast } from "@/services/ime/imeToast";
import { handleWorkspaceSaveAs } from "@/services/mcpBridge/v2/workspaceSaveAs";
import { resetBridge, responseTo, setAutoApproveEdits } from "./bridgeDiskHarness";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";

const ORIGINAL = `${ROOT}/original.md`;

beforeEach(() => {
  resetBridge();
  statefulFs.stubCommand("mcp_bridge_check_path", () => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("save_as to another spelling of the tab's own file", () => {
  it.each([`${ROOT}/./original.md`, `${ROOT}//original.md`])(
    "%s saves, asking no approval and refusing no overwrite",
    async (alias) => {
      const warning = vi.spyOn(imeToast, "warning").mockImplementation(() => "toast-id");
      const tabId = await openDocInTab(ORIGINAL, "hi\n");
      editDoc(tabId, "hi again\n");
      setAutoApproveEdits(false);
      const writes: Array<Record<string, unknown>> = [];
      statefulFs.stubCommand("atomic_write_file", (args) => void writes.push(args));

      await handleWorkspaceSaveAs("req-alias", { tabId, filePath: alias }, TEST_WRITE_CONTEXT);

      expect(responseTo("req-alias").error ?? null).toBeNull();
      expect(warning).not.toHaveBeenCalled();
      expect(writes).toEqual([
        { path: alias, content: "hi again\n", order: { seq: expect.any(Number) } },
      ]);
    },
  );
});
