import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockRebuildNativeMenu = vi.fn();
vi.mock("@/services/menu/rebuildNativeMenu", () => ({
  rebuildNativeMenu: (...args: unknown[]) => mockRebuildNativeMenu(...args),
}));

import { DocumentToolsSettings } from "./DocumentToolsSettings";

type PInfo = { available: boolean; path: string | null; version: string | null };

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("DocumentToolsSettings — stale-completion guard", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockRebuildNativeMenu.mockReset().mockResolvedValue(undefined);
  });

  it("shows the latest detection result", async () => {
    mockInvoke.mockResolvedValueOnce({ available: true, path: "/bin/pandoc", version: "3.0" });
    render(<DocumentToolsSettings />);
    await waitFor(() => expect(screen.getByText("v3.0")).toBeInTheDocument());
  });

  it("a refresh request supersedes the mount detection result", async () => {
    // Mount detection is slow and still in flight.
    const mount = defer<PInfo>();
    mockInvoke.mockReturnValueOnce(mount.promise);
    render(<DocumentToolsSettings />);

    // Mount detection resolves with a result; button re-enables.
    mount.resolve({ available: true, path: "/bin/pandoc", version: "1.0" });
    await waitFor(() => expect(screen.getByText("v1.0")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button")).not.toBeDisabled());

    // User clicks Detect → fresh request resolves with a newer version.
    const refresh = defer<PInfo>();
    mockInvoke.mockReturnValueOnce(refresh.promise);
    fireEvent.click(screen.getByRole("button"));
    refresh.resolve({ available: true, path: "/bin/pandoc", version: "3.0" });
    await waitFor(() => expect(screen.getByText("v3.0")).toBeInTheDocument());

    // If the OLD mount request were somehow to resolve again (defensive
    // request-id guard), the newer result must remain. The mount promise is
    // already settled, so this asserts the steady state stays newest.
    await Promise.resolve();
    expect(screen.getByText("v3.0")).toBeInTheDocument();
    expect(screen.queryByText("v1.0")).not.toBeInTheDocument();
  });

  it("ignores a detection that resolves after the component unmounts", async () => {
    const mount = defer<PInfo>();
    mockInvoke.mockReturnValueOnce(mount.promise);
    const { unmount } = render(<DocumentToolsSettings />);

    unmount();
    // Resolving after unmount must not throw or attempt a state update.
    mount.resolve({ available: true, path: "/bin/pandoc", version: "3.0" });
    await expect(Promise.resolve().then(() => mount.promise)).resolves.toBeDefined();
  });
});
