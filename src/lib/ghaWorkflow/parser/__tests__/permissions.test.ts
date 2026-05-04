// WI-1.3 — permissions normalization tests.
//
// Per plan §4 PermissionsIR + ADR-7. Source YAML uses kebab-case
// (`pull-requests`, `id-token`); we normalize to camelCase TS keys.
// Aliases: `read-all`, `write-all`, `none` are passed through as literals.

import { describe, expect, it } from "vitest";
import { parsePermissions } from "../permissions";

describe("parsePermissions", () => {
  it("handles read-all alias", () => {
    expect(parsePermissions("read-all")).toEqual({ value: "read-all" });
  });

  it("handles write-all alias", () => {
    expect(parsePermissions("write-all")).toEqual({ value: "write-all" });
  });

  it("handles empty-object form (none)", () => {
    expect(parsePermissions({}).value).toEqual({});
  });

  it("translates kebab-case scopes to camelCase", () => {
    const result = parsePermissions({
      "pull-requests": "write",
      "id-token": "write",
      "security-events": "read",
      contents: "read",
    });
    expect(result.value).toEqual({
      pullRequests: "write",
      idToken: "write",
      securityEvents: "read",
      contents: "read",
    });
  });

  it("preserves levels: read, write, none", () => {
    const result = parsePermissions({
      contents: "read",
      issues: "write",
      packages: "none",
    });
    expect(result.value).toEqual({
      contents: "read",
      issues: "write",
      packages: "none",
    });
  });

  it("ignores unknown keys (forwards-compat)", () => {
    const result = parsePermissions({
      contents: "read",
      "future-scope-name": "write",
    });
    expect(result.value).toEqual({ contents: "read" });
  });

  it("ignores invalid level strings", () => {
    const result = parsePermissions({
      contents: "yes",
      issues: "write",
    });
    expect(result.value).toEqual({ issues: "write" });
  });
});
