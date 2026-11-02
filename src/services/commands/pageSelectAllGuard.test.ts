// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerCommand,
  restoreCommandRegistry,
  snapshotCommandRegistry,
  unregisterCommand,
} from "./CommandBus";
import { installPageSelectAllGuard } from "./pageSelectAllGuard";

const run = vi.fn<() => Promise<void>>();

function fireSelectStart(target: EventTarget): Event {
  const event = new Event("selectstart", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe("installPageSelectAllGuard", () => {
  let uninstall: () => void;
  let registry: ReturnType<typeof snapshotCommandRegistry>;

  beforeEach(() => {
    registry = snapshotCommandRegistry();
    unregisterCommand("edit.selectAll");
    run.mockReset();
    run.mockResolvedValue(undefined);
    registerCommand({ id: "edit.selectAll", title: () => "Select All", run });
    uninstall = installPageSelectAllGuard();
  });

  afterEach(() => {
    uninstall();
    restoreCommandRegistry(registry);
    document.body.replaceChildren();
  });

  it("cancels a page-wide Select All and sends it to the editor instead", () => {
    const event = fireSelectStart(document.body);
    expect(event.defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("treats the root element as page-wide too", () => {
    expect(fireSelectStart(document.documentElement).defaultPrevented).toBe(true);
  });

  it("still cancels where no editor command exists (Settings, PDF export)", async () => {
    unregisterCommand("edit.selectAll");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(fireSelectStart(document.body).defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("leaves a Select All inside an editable surface alone", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    document.body.append(editor);
    expect(fireSelectStart(editor).defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("leaves a Select All inside a text field alone", () => {
    const input = document.createElement("input");
    document.body.append(input);
    expect(fireSelectStart(input).defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("leaves a mouse selection in read-only text alone", () => {
    const text = document.createElement("p");
    text.textContent = "copy me";
    document.body.append(text);
    expect(fireSelectStart(text.firstChild as Text).defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not re-enter when the redirected command lands on the page again", async () => {
    let release: () => void = () => {};
    run.mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );

    fireSelectStart(document.body);
    // The editor could not take focus, so the native action hits the page again.
    const second = fireSelectStart(document.body);

    expect(second.defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);

    release();
    await vi.waitFor(() => {
      fireSelectStart(document.body);
      expect(run).toHaveBeenCalledTimes(2);
    });
  });

  it("still cancels, reports, and recovers when the command fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    run.mockRejectedValueOnce(new Error("native edit failed"));

    expect(fireSelectStart(document.body).defaultPrevented).toBe(true);

    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    fireSelectStart(document.body);
    expect(run).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it("stops guarding once uninstalled", () => {
    uninstall();
    expect(fireSelectStart(document.body).defaultPrevented).toBe(false);
    uninstall = installPageSelectAllGuard();
  });
});
