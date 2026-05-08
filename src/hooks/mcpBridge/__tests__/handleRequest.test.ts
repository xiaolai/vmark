// Coverage for the top-level MCP request router. Specifically:
//   - read-only docs reject mutations with a structured READ_ONLY envelope
//     (the v2 contract — not the legacy plain-string error)
//   - reads still pass through when the doc is read-only
//   - unknown request types respond with a clear error
//   - handler exceptions are caught and reported

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleRequest } from "../handleRequest";

const mockIsActiveDocReadOnly = vi.fn(() => false);
vi.mock("@/utils/readOnlyGuard", () => ({
  isActiveDocReadOnly: () => mockIsActiveDocReadOnly(),
}));

vi.mock("../utils", () => ({
  respond: vi.fn(),
}));

const mockDispatchV2 = vi.fn(async (_event: unknown) => false);
vi.mock("../v2/dispatch", () => ({
  dispatchV2: (event: unknown) => mockDispatchV2(event),
}));

import { respond } from "../utils";

function lastRespond() {
  const calls = vi.mocked(respond).mock.calls;
  return calls[calls.length - 1][0];
}

function parseStructuredError(s: string | undefined) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsActiveDocReadOnly.mockReturnValue(false);
  mockDispatchV2.mockResolvedValue(false);
});

describe("handleRequest — READ_ONLY envelope", () => {
  it.each([
    "vmark.document.write",
    "vmark.document.transform",
    "vmark.workflow.apply_patch",
    "vmark.selection.set",
  ])("rejects %s with a structured READ_ONLY envelope on read-only docs", async (type) => {
    mockIsActiveDocReadOnly.mockReturnValue(true);

    await handleRequest({ id: "req-ro", type, args: {} });

    const r = lastRespond();
    expect(r.success).toBe(false);
    const err = parseStructuredError(r.error);
    expect(err).toMatchObject({
      error: "READ_ONLY",
      message: expect.any(String),
    });
    // Dispatcher must NOT be invoked when the read-only guard blocks.
    expect(mockDispatchV2).not.toHaveBeenCalled();
  });

  it("does not block reads on read-only docs (read still routes through dispatchV2)", async () => {
    mockIsActiveDocReadOnly.mockReturnValue(true);
    mockDispatchV2.mockResolvedValue(true); // the dispatcher would handle it

    await handleRequest({ id: "req-read", type: "vmark.document.read", args: {} });

    expect(mockDispatchV2).toHaveBeenCalledTimes(1);
    // No respond call from THIS function — the routed handler would respond.
    expect(respond).not.toHaveBeenCalled();
  });

  it("does not block selection.get on read-only docs", async () => {
    mockIsActiveDocReadOnly.mockReturnValue(true);
    mockDispatchV2.mockResolvedValue(true);

    await handleRequest({ id: "req-sg", type: "vmark.selection.get", args: {} });

    expect(mockDispatchV2).toHaveBeenCalledTimes(1);
    expect(respond).not.toHaveBeenCalled();
  });
});

describe("handleRequest — unknown types", () => {
  it("responds with an Unknown request error when dispatchV2 returns false", async () => {
    mockDispatchV2.mockResolvedValue(false);

    await handleRequest({ id: "req-?", type: "vmark.bogus", args: {} });

    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(r.error).toContain("Unknown request type");
    expect(r.error).toContain("vmark.bogus");
  });
});

describe("handleRequest — error handling", () => {
  it("catches handler exceptions and responds with the error message", async () => {
    mockDispatchV2.mockRejectedValueOnce(new Error("boom"));

    await handleRequest({ id: "req-err", type: "vmark.document.read", args: {} });

    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(r.error).toBe("boom");
  });

  it("stringifies non-Error throws", async () => {
    mockDispatchV2.mockRejectedValueOnce("plain string failure");

    await handleRequest({ id: "req-str", type: "vmark.document.read", args: {} });

    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(r.error).toBe("plain string failure");
  });
});
