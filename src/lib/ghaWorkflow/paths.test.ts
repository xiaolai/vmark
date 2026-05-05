// WI-B0 — workspace-relative path resolution for `uses:` refs.

import { describe, it, expect } from "vitest";
import {
  resolveLocalUsesRef,
  isLocalUsesRef,
  type ResolvedLocalRef,
} from "./paths";

describe("isLocalUsesRef", () => {
  it.each([
    ["./foo", true],
    ["./.github/actions/setup", true],
    ["../shared/action.yml", true],
    ["./foo.yml", true],
    ["./foo.yaml", true],
    ["./.github/workflows/build.yml@main", true],
    ["actions/checkout@v4", false],
    ["docker://node:20", false],
    ["", false],
    ["./", false],
    ["../", false],
  ])("isLocalUsesRef(%j) → %s", (input, expected) => {
    expect(isLocalUsesRef(input)).toBe(expected);
  });
});

describe("resolveLocalUsesRef — action references", () => {
  const wsRoot = "/repo";
  const workflowFile = "/repo/.github/workflows/ci.yml";

  it("./relative resolves under workspace root + appends action.yml", () => {
    const got = resolveLocalUsesRef("./.github/actions/setup", workflowFile, wsRoot);
    expect(got.kind).toBe("action");
    expect(got.absPath).toBe("/repo/.github/actions/setup/action.yml");
  });

  it("./action with explicit .yml uses that path", () => {
    const got = resolveLocalUsesRef(
      "./.github/actions/setup/action.yml",
      workflowFile,
      wsRoot,
    );
    expect(got.kind).toBe("action");
    expect(got.absPath).toBe("/repo/.github/actions/setup/action.yml");
  });

  it("../path is rejected — would escape workspace root (GHA paths anchor at root)", () => {
    const got = resolveLocalUsesRef("../shared", workflowFile, wsRoot);
    expect(got.kind).toBe("escaped");
  });

  it("path-traversal escapes are rejected", () => {
    const got = resolveLocalUsesRef("../../etc/passwd", workflowFile, wsRoot);
    expect(got.kind).toBe("escaped");
  });

  it("Windows backslash separator handled", () => {
    // .\\.github\\actions\\setup (escaped JS string literal of `.\.github\actions\setup`)
    const got = resolveLocalUsesRef(
      ".\\.github\\actions\\setup",
      workflowFile,
      wsRoot,
    );
    expect(got.kind).toBe("action");
    expect(got.absPath).toBe("/repo/.github/actions/setup/action.yml");
  });
});

describe("resolveLocalUsesRef — reusable workflow references", () => {
  const wsRoot = "/repo";
  const workflowFile = "/repo/.github/workflows/ci.yml";

  it("./.github/workflows/build.yml@main resolves to the workflow file", () => {
    const got = resolveLocalUsesRef(
      "./.github/workflows/build.yml@main",
      workflowFile,
      wsRoot,
    );
    expect(got.kind).toBe("workflow");
    expect(got.absPath).toBe("/repo/.github/workflows/build.yml");
    expect((got as ResolvedLocalRef & { kind: "workflow" }).gitRef).toBe(
      "main",
    );
  });

  it("workflow without @ref still resolves", () => {
    const got = resolveLocalUsesRef(
      "./.github/workflows/build.yml",
      workflowFile,
      wsRoot,
    );
    expect(got.kind).toBe("workflow");
    expect(got.absPath).toBe("/repo/.github/workflows/build.yml");
  });
});

describe("resolveLocalUsesRef — invalid", () => {
  it("returns 'invalid' for non-local refs", () => {
    expect(
      resolveLocalUsesRef("actions/checkout@v4", "/repo/.github/workflows/ci.yml", "/repo")
        .kind,
    ).toBe("invalid");
  });
});

describe("resolveLocalUsesRef — Windows drive roots", () => {
  it("preserves the C: drive prefix in the resolved path", () => {
    const got = resolveLocalUsesRef(
      "./.github/actions/setup",
      "C:\\repo\\.github\\workflows\\ci.yml",
      "C:\\repo",
    );
    expect(got.kind).toBe("action");
    expect(got.absPath).toBe("C:/repo/.github/actions/setup/action.yml");
  });

  it("preserves UNC share prefix in the resolved path", () => {
    const got = resolveLocalUsesRef(
      "./.github/actions/setup",
      "//server/share/repo/.github/workflows/ci.yml",
      "//server/share/repo",
    );
    expect(got.kind).toBe("action");
    expect(got.absPath).toBe(
      "//server/share/repo/.github/actions/setup/action.yml",
    );
  });

  it("Windows path-traversal is still refused", () => {
    const got = resolveLocalUsesRef(
      "../../../../etc",
      "C:\\repo\\.github\\workflows\\ci.yml",
      "C:\\repo",
    );
    expect(got.kind).toBe("escaped");
  });
});
