// @vitest-environment node
// WI-AL4.1 — the Git export client (`agent_journal_git_export`): the payload carries the document key and the absolute repository folder as JSON (Windows backslash paths, spaces and CJK kept verbatim); the report is checked before it is trusted (counts are safe integers); a refusal's exportCode (GIT_MISSING, NOT_A_REPOSITORY, EXPORT_CONFLICT, UNRELATED_BRANCH, BRANCH_CHECKED_OUT, …) is read back, and an unknown or absent code is null rather than guessed
import { describe, it, expect, vi, beforeEach } from "vitest";

import { invoke } from "@tauri-apps/api/core";
import { exportDocumentToGit, gitExportFailureCode } from "../gitExportClient";

const invokeMock = vi.mocked(invoke);
const report = { branch: "vmark-journal/0190d3c4-0000-7000-8000-000000000001", head: "a".repeat(40), commitsCreated: 3, syntheticCreated: 1 };

beforeEach(() => {
  invokeMock.mockReset();
});

describe("exportDocumentToGit", () => {
  it("sends the key and folder as one JSON payload and returns the report", async () => {
    invokeMock.mockResolvedValueOnce(report);
    const key = "path:C:\\Users\\me\\My Notes\\计划.md";
    const repo = "C:\\Users\\me\\仓库 repo";
    await expect(exportDocumentToGit(key, repo)).resolves.toEqual(report);
    expect(invokeMock).toHaveBeenCalledWith("agent_journal_git_export", {
      payload: JSON.stringify({ docKey: key, repository: repo }),
    });
    const sent = JSON.parse(String((invokeMock.mock.calls[0][1] as { payload: string }).payload));
    expect(sent).toEqual({ docKey: key, repository: repo });
  });

  it("accepts a report with no head (nothing to export)", async () => {
    invokeMock.mockResolvedValueOnce({ ...report, head: null, commitsCreated: 0, syntheticCreated: 0 });
    await expect(exportDocumentToGit("tab:main/t1", "/r")).resolves.toMatchObject({ head: null, commitsCreated: 0 });
  });

  it.each([
    ["not an object", "ok"],
    ["missing branch", { ...report, branch: "" }],
    ["a negative count", { ...report, commitsCreated: -1 }],
    ["a fractional count", { ...report, syntheticCreated: 0.5 }],
    ["a count past the safe integer range", { ...report, commitsCreated: 2 ** 53, syntheticCreated: 0 }],
    ["more synthetic than created", { ...report, commitsCreated: 1, syntheticCreated: 2 }],
    ["a non-string head", { ...report, head: 7 }],
    ["no head but commits created", { ...report, head: null, commitsCreated: 2, syntheticCreated: 0 }],
  ])("refuses a malformed reply: %s", async (_name, reply) => {
    invokeMock.mockResolvedValueOnce(reply);
    await expect(exportDocumentToGit("path:/a.md", "/r")).rejects.toThrow(/malformed/);
  });

  it("rethrows a refusal unchanged so its code can be read", async () => {
    const refusal = { code: "conflict", message: "export branch changed", detail: { exportCode: "EXPORT_CONFLICT" } };
    invokeMock.mockRejectedValueOnce(refusal);
    await expect(exportDocumentToGit("path:/a.md", "/r")).rejects.toBe(refusal);
  });
});

describe("gitExportFailureCode", () => {
  it.each(["GIT_MISSING", "NO_HISTORY", "NOT_A_REPOSITORY", "INVALID_REQUEST", "EXPORT_CONFLICT", "UNRELATED_BRANCH", "BRANCH_CHECKED_OUT", "GIT_FAILED", "JOURNAL_ERROR"])(
    "reads %s",
    (code) => {
      expect(gitExportFailureCode({ code: "conflict", message: "m", detail: { exportCode: code } })).toBe(code);
    },
  );

  it.each([
    ["an unknown code", { code: "conflict", message: "m", detail: { exportCode: "SOMETHING_NEW" } }],
    ["no detail", { code: "conflict", message: "m" }],
    ["a plain Error", new Error("boom")],
    ["a string", "boom"],
    ["undefined", undefined],
  ])("is null for %s", (_name, error) => {
    expect(gitExportFailureCode(error)).toBeNull();
  });
});
