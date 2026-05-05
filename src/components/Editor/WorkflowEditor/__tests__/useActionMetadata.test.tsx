// useActionMetadata — async hook over the Phase 6 action registry.
//
// Tests cover:
//   1. Returns { state: "idle" } for unfetchable uses (./local, missing @ref).
//   2. Walks idle → loading → success when invoke resolves to "ok".
//   3. Walks idle → loading → unavailable on any failure variant.
//   4. Does not invoke twice for the same uses-string (registry memo).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { __resetRegistryForTests } from "@/lib/ghaWorkflow/actions/registry";
import { useActionMetadata } from "../useActionMetadata";

beforeEach(() => {
  __resetRegistryForTests();
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useActionMetadata", () => {
  it("local refs (./...) are now resolvable — transitions to unavailable when no workspace context (WI-B.1)", async () => {
    // Local action refs used to be 'idle' (registry returned null
    // before any work). After WI-B.1 they transition through
    // 'loading' to 'unavailable' (no workflow tab open in test).
    const { result } = renderHook(() => useActionMetadata("./local/action"));
    await act(async () => {});
    await act(async () => {});
    expect(result.current.state).toBe("unavailable");
    // Still no Rust invoke — local refs resolve via fs.readTextFile.
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("docker:// uses stays idle (no resolution path)", async () => {
    const { result } = renderHook(() =>
      useActionMetadata("docker://node:20"),
    );
    await act(async () => {});
    expect(result.current.state).toBe("idle");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("idle for empty uses (run-step, no action ref)", async () => {
    const { result } = renderHook(() => useActionMetadata(undefined));
    expect(result.current.state).toBe("idle");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("transitions to success with metadata on Ok", async () => {
    invokeMock.mockResolvedValueOnce({
      kind: "ok",
      from_cache: false,
      metadata: {
        name: "Checkout",
        description: "Check out the repo",
        inputs: {
          "fetch-depth": {
            description: "Number of commits",
            required: false,
            default: "1",
          },
          token: {
            description: "GitHub auth token",
            required: false,
            default: "${{ github.token }}",
          },
        },
        outputs: {},
      },
    });
    const { result } = renderHook(() =>
      useActionMetadata("actions/checkout@v4"),
    );
    expect(result.current.state).toBe("loading");
    await waitFor(() => {
      expect(result.current.state).toBe("success");
    });
    if (result.current.state !== "success") return; // type narrow
    expect(result.current.metadata.name).toBe("Checkout");
    expect(result.current.metadata.inputs["fetch-depth"].description).toBe(
      "Number of commits",
    );
  });

  it("transitions to unavailable on NotFound", async () => {
    invokeMock.mockResolvedValueOnce({
      kind: "not_found",
      message: "no action.yml",
    });
    const { result } = renderHook(() =>
      useActionMetadata("nobody/nope@v1"),
    );
    await waitFor(() => {
      expect(result.current.state).toBe("unavailable");
    });
  });

  it("transitions to unavailable on NetworkError", async () => {
    invokeMock.mockResolvedValueOnce({
      kind: "network_error",
      message: "timeout",
    });
    const { result } = renderHook(() =>
      useActionMetadata("actions/checkout@v4"),
    );
    await waitFor(() => {
      expect(result.current.state).toBe("unavailable");
    });
  });

  it("does not re-invoke when the same uses is rendered again", async () => {
    invokeMock.mockResolvedValue({
      kind: "ok",
      from_cache: false,
      metadata: { inputs: {}, outputs: {} },
    });
    const first = renderHook(() => useActionMetadata("actions/checkout@v4"));
    await waitFor(() => {
      expect(first.result.current.state).toBe("success");
    });
    const second = renderHook(() => useActionMetadata("actions/checkout@v4"));
    await waitFor(() => {
      expect(second.result.current.state).toBe("success");
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
