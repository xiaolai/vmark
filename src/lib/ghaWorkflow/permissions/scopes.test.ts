// Codex audit HIGH-2 fix — bidirectional kebab↔camel scope key map.

import { describe, it, expect } from "vitest";
import {
  COMMON_SCOPES_KEBAB,
  kebabToCamel,
  camelToKebab,
  irToYamlMap,
  yamlMapToIr,
} from "./scopes";

describe("scope key conversion", () => {
  it("kebabToCamel handles single-word and hyphenated", () => {
    expect(kebabToCamel("contents")).toBe("contents");
    expect(kebabToCamel("pull-requests")).toBe("pullRequests");
    expect(kebabToCamel("id-token")).toBe("idToken");
    expect(kebabToCamel("security-events")).toBe("securityEvents");
  });

  it("camelToKebab is the inverse of kebabToCamel for known scopes", () => {
    for (const kebab of COMMON_SCOPES_KEBAB) {
      expect(camelToKebab(kebabToCamel(kebab))).toBe(kebab);
    }
  });

  it("irToYamlMap converts {pullRequests:'read'} → {'pull-requests':'read'}", () => {
    expect(
      irToYamlMap({ pullRequests: "read", contents: "write" }),
    ).toEqual({ "pull-requests": "read", contents: "write" });
  });

  it("yamlMapToIr converts {'id-token':'write'} → {idToken:'write'}", () => {
    expect(yamlMapToIr({ "id-token": "write", contents: "read" })).toEqual({
      idToken: "write",
      contents: "read",
    });
  });

  it("round-trip preserves all common scopes", () => {
    const yaml: Record<string, "read" | "write" | "none"> = {};
    for (const k of COMMON_SCOPES_KEBAB) yaml[k] = "read";
    expect(irToYamlMap(yamlMapToIr(yaml))).toEqual(yaml);
  });
});
