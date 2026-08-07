// @vitest-environment node
// WI-3.5/3.6 — operator service: propose/preview/accept over the coherence IPC.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import {
  acceptCandidate,
  previewCandidate,
  proposeOperator,
  type OperatorCandidate,
} from "./operatorService";

const mockInvoke = vi.mocked(invoke);

function candidate(over: Partial<OperatorCandidate> = {}): OperatorCandidate {
  return {
    object: "obj-1",
    content: "revised",
    base: "rev1:aa",
    operator: "tidy",
    summary: "trim",
    revision: "rev1:bb",
    ...over,
  };
}

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("proposeOperator", () => {
  it("invokes the propose command with the object + live content", async () => {
    const cands = [candidate()];
    mockInvoke.mockResolvedValueOnce(cands);
    const out = await proposeOperator("/ws", "obj-1", "live text");
    expect(mockInvoke).toHaveBeenCalledWith("coherence_operator_propose", {
      workspaceRoot: "/ws",
      object: "obj-1",
      content: "live text",
    });
    expect(out).toEqual(cands);
  });

  it("propagates a command error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("no single live head"));
    await expect(proposeOperator("/ws", "obj-1", "x")).rejects.toThrow(
      "no single live head",
    );
  });
});

describe("previewCandidate", () => {
  it("invokes preview and returns the delta + class snapshot", async () => {
    const result = {
      candidateRevision: "rev1:bb",
      localDelta: [],
      structuralClasses: [],
      truncated: false,
    };
    mockInvoke.mockResolvedValueOnce(result);
    const c = candidate();
    const out = await previewCandidate("/ws", c);
    expect(mockInvoke).toHaveBeenCalledWith("coherence_operator_preview", {
      workspaceRoot: "/ws",
      candidate: c,
    });
    expect(out.candidateRevision).toBe("rev1:bb");
  });
});

describe("acceptCandidate", () => {
  it("resubmits the candidate + structural classes to accept", async () => {
    const receipt = { entryId: "e-1", revision: "rev1:bb", committed: true };
    mockInvoke.mockResolvedValueOnce(receipt);
    const c = candidate();
    const classes: [never, never][] = [];
    const out = await acceptCandidate("/ws", c, classes);
    expect(mockInvoke).toHaveBeenCalledWith("coherence_operator_accept", {
      workspaceRoot: "/ws",
      candidate: c,
      structuralClasses: classes,
    });
    expect(out.committed).toBe(true);
  });

  it("surfaces a stale-base rejection", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("stale base — re-preview required"));
    await expect(acceptCandidate("/ws", candidate(), [])).rejects.toThrow(
      "stale base",
    );
  });
});
