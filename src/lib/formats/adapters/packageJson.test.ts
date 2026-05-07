// WI-5.1 — package.json schema detector + dependency-tree renderer tests.

import { describe, expect, it } from "vitest";
import {
  packageJsonSchemaDetector,
  collectPackageJsonDependencies,
} from "./packageJson";

describe("packageJsonSchemaDetector", () => {
  it("matches files named package.json (POSIX path)", () => {
    expect(
      packageJsonSchemaDetector(
        "/repo/package.json",
        '{"name":"x","dependencies":{}}',
      ),
    ).toBe("package-json");
  });

  it("matches files named package.json (Windows backslash)", () => {
    expect(
      packageJsonSchemaDetector(
        "C:\\code\\repo\\package.json",
        '{"name":"x"}',
      ),
    ).toBe("package-json");
  });

  it("strips query string before path match", () => {
    expect(
      packageJsonSchemaDetector("/repo/package.json?reload=1", "{}"),
    ).toBe("package-json");
  });

  it("is case-insensitive on the filename", () => {
    expect(
      packageJsonSchemaDetector("/repo/PACKAGE.JSON", "{}"),
    ).toBe("package-json");
  });

  it("matches content with name + dependencies/devDependencies field even at unrelated path", () => {
    const content = JSON.stringify({
      name: "still-a-package-manifest",
      version: "1.0.0",
      dependencies: { lodash: "^4.0.0" },
    });
    expect(
      packageJsonSchemaDetector("/x/odd-name.json", content),
    ).toBe("package-json");
  });

  it("returns null for unrelated JSON at unrelated path", () => {
    expect(
      packageJsonSchemaDetector(
        "/x/data.json",
        '{"foo": 1, "bar": 2}',
      ),
    ).toBeNull();
  });

  it("returns null for syntactically invalid JSON at unrelated path (ADR-5)", () => {
    expect(
      packageJsonSchemaDetector("/x/broken.json", "{ not json"),
    ).toBeNull();
  });

  it("path detection still wins on syntactically invalid JSON", () => {
    // .../package.json with broken content still routes — degraded
    // view + diagnostics, per ADR-5 path-first rule.
    expect(
      packageJsonSchemaDetector("/repo/package.json", "{ broken"),
    ).toBe("package-json");
  });
});

describe("collectPackageJsonDependencies", () => {
  it("returns empty arrays for a manifest with no deps", () => {
    const result = collectPackageJsonDependencies(
      JSON.stringify({ name: "vmark", version: "0.7.0" }),
    );
    expect(result.runtime).toEqual([]);
    expect(result.dev).toEqual([]);
    expect(result.peer).toEqual([]);
    expect(result.optional).toEqual([]);
  });

  it("collects all four dependency groups", () => {
    const content = JSON.stringify({
      name: "x",
      dependencies: { react: "^19.0.0", lodash: "^4.0.0" },
      devDependencies: { vitest: "^4.0.0" },
      peerDependencies: { "react-dom": "^19.0.0" },
      optionalDependencies: { fsevents: "^2.0.0" },
    });
    const result = collectPackageJsonDependencies(content);
    expect(result.runtime).toEqual([
      { name: "react", version: "^19.0.0" },
      { name: "lodash", version: "^4.0.0" },
    ]);
    expect(result.dev).toEqual([{ name: "vitest", version: "^4.0.0" }]);
    expect(result.peer).toEqual([{ name: "react-dom", version: "^19.0.0" }]);
    expect(result.optional).toEqual([
      { name: "fsevents", version: "^2.0.0" },
    ]);
  });

  it("handles git / file: / npm-aliased deps without throwing", () => {
    const content = JSON.stringify({
      dependencies: {
        local: "file:../sibling",
        upstream: "git+https://example.com/repo.git",
        aliased: "npm:lodash@4",
      },
    });
    const result = collectPackageJsonDependencies(content);
    expect(result.runtime.map((d) => d.name).sort()).toEqual([
      "aliased",
      "local",
      "upstream",
    ]);
  });

  it("returns empty result on syntax error rather than throwing", () => {
    const result = collectPackageJsonDependencies("{ bad json");
    expect(result.runtime).toEqual([]);
    expect(result.parseError).toBeDefined();
  });

  it("ignores non-string values in dep maps", () => {
    const content = JSON.stringify({
      dependencies: { good: "1.0.0", bad: 42, alsoBad: { nested: "1" } },
    });
    const result = collectPackageJsonDependencies(content);
    expect(result.runtime).toEqual([{ name: "good", version: "1.0.0" }]);
  });
});
