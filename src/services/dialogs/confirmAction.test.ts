// WI-UI4.1 — the ONE confirmation dialog: every destructive confirm goes
// through confirmAction, whose signature REQUIRES a verb on the button.
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const askMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => askMock(...args),
}));
vi.mock("@/i18n", () => ({
  default: { t: (k: string) => (k === "dialog:common.cancel" ? "Cancel" : k) },
}));

import { confirmAction } from "./confirmAction";

beforeEach(() => askMock.mockReset());

describe("confirmAction (WI-UI4.1)", () => {
  it("threads title, message, kind and the VERB label into ask()", async () => {
    askMock.mockResolvedValue(true);
    const ok = await confirmAction({
      title: "Delete File",
      message: 'Delete "a.md"?',
      actionLabel: "Delete",
      kind: "warning",
    });
    expect(ok).toBe(true);
    expect(askMock).toHaveBeenCalledWith('Delete "a.md"?', {
      title: "Delete File",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Cancel",
    });
  });

  it("returns false when the user declines", async () => {
    askMock.mockResolvedValue(false);
    await expect(
      confirmAction({ title: "T", message: "M", actionLabel: "Remove", kind: "info" }),
    ).resolves.toBe(false);
  });

  it("the action label is REQUIRED at the type level", () => {
    // @ts-expect-error — actionLabel missing must not compile
    const bad = () => confirmAction({ title: "T", message: "M", kind: "warning" });
    expect(bad).toBeDefined();
  });
});
