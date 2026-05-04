// WI-6.1 — action metadata registry tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  __resetRegistryForTests,
  getActionMetadata,
  parseUsesRef,
} from "../registry";

describe("parseUsesRef", () => {
  it("parses owner/repo@ref", () => {
    expect(parseUsesRef("actions/checkout@v4")).toEqual({
      owner: "actions",
      repo: "checkout",
      path: "",
      ref: "v4",
    });
  });

  it("parses owner/repo/sub/path@ref", () => {
    expect(parseUsesRef("actions/foo/sub/path@main")).toEqual({
      owner: "actions",
      repo: "foo",
      path: "sub/path",
      ref: "main",
    });
  });

  it("returns null for local refs", () => {
    expect(parseUsesRef("./.github/actions/setup")).toBeNull();
  });

  it("returns null for docker URIs", () => {
    expect(parseUsesRef("docker://alpine:3.18")).toBeNull();
  });

  it("returns null for missing @ref", () => {
    expect(parseUsesRef("actions/checkout")).toBeNull();
  });
});

describe("getActionMetadata", () => {
  beforeEach(() => {
    __resetRegistryForTests();
    invokeMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null and skips invoke for unparseable uses", async () => {
    const result = await getActionMetadata("./local/action");
    expect(result).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("forwards the result on FetchResult.Ok", async () => {
    invokeMock.mockResolvedValueOnce({
      kind: "ok",
      from_cache: false,
      metadata: {
        name: "Checkout",
        description: "Check out the repo",
        author: "GitHub",
        inputs: {
          "fetch-depth": {
            description: "Number of commits",
            required: false,
            default: "1",
          },
        },
        outputs: {},
        runs_using: "node20",
      },
    });
    const result = await getActionMetadata("actions/checkout@v4");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Checkout");
    expect(result!.inputs["fetch-depth"].description).toBe("Number of commits");
  });

  it("returns null on FetchResult.NotFound (silently)", async () => {
    invokeMock.mockResolvedValueOnce({
      kind: "not_found",
      message: "no action.yml",
    });
    expect(await getActionMetadata("nobody/nope@v1")).toBeNull();
  });

  it("returns null on FetchResult.NetworkError + records the error", async () => {
    invokeMock.mockResolvedValueOnce({
      kind: "network_error",
      message: "timeout",
    });
    const result = await getActionMetadata("actions/checkout@v4");
    expect(result).toBeNull();
  });

  it("memoizes within session — second call doesn't re-invoke", async () => {
    invokeMock.mockResolvedValue({
      kind: "ok",
      from_cache: false,
      metadata: { name: "x", inputs: {}, outputs: {} },
    });
    await getActionMetadata("actions/checkout@v4");
    await getActionMetadata("actions/checkout@v4");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("differentiates by ref (v4 vs v5 cache separately)", async () => {
    invokeMock.mockResolvedValue({
      kind: "ok",
      from_cache: false,
      metadata: { name: "x", inputs: {}, outputs: {} },
    });
    await getActionMetadata("actions/checkout@v4");
    await getActionMetadata("actions/checkout@v5");
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("does not throw on Tauri invoke rejection — returns null", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Tauri command unregistered"));
    const result = await getActionMetadata("actions/checkout@v4");
    expect(result).toBeNull();
  });

  it("retries on transient NetworkError (does not poison the cache)", async () => {
    // Audit fix: a single network blip used to disable metadata for
    // the rest of the session. Now NetworkError is not cached.
    invokeMock.mockResolvedValueOnce({ kind: "network_error", message: "x" });
    const first = await getActionMetadata("actions/checkout@v4");
    expect(first).toBeNull();
    invokeMock.mockResolvedValueOnce({
      kind: "ok",
      from_cache: false,
      metadata: { name: "Checkout", inputs: {}, outputs: {} },
    });
    const second = await getActionMetadata("actions/checkout@v4");
    expect(second).not.toBeNull();
    expect(second?.name).toBe("Checkout");
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("caches stable NotFound across calls (no re-invoke)", async () => {
    invokeMock.mockResolvedValueOnce({
      kind: "not_found",
      message: "no action.yml",
    });
    await getActionMetadata("nobody/nope@v1");
    await getActionMetadata("nobody/nope@v1");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("retries on Tauri invoke rejection (does not poison the cache)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Tauri command unregistered"));
    const first = await getActionMetadata("actions/checkout@v4");
    expect(first).toBeNull();
    invokeMock.mockResolvedValueOnce({
      kind: "ok",
      from_cache: false,
      metadata: { name: "Checkout", inputs: {}, outputs: {} },
    });
    const second = await getActionMetadata("actions/checkout@v4");
    expect(second).not.toBeNull();
  });
});
