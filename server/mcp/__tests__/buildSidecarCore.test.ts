/**
 * Tests for the sidecar build core (WI-5) — target resolution, stale-artifact
 * replacement, sequential failure aggregation, and cleanup, all through
 * injected dependencies (no real esbuild/pkg).
 */
import { describe, it, expect, vi } from "vitest";
import {
  NODE_RUNTIME,
  TARGET_MAP,
  resolveTargets,
  resolveBinScript,
  meaningfulStderr,
  buildForTarget,
  runBuild,
} from "../scripts/build-sidecar-core.mjs";

function makeDeps(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const deps = {
    runTool: vi.fn(async (args: string[]) => {
      calls.push(args[0] === "esbuild" ? "esbuild" : `pkg:${args[args.indexOf("--target") + 1]}`);
      return { stdout: "", stderr: "" };
    }),
    mkdir: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
    access: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    log: vi.fn(),
    error: vi.fn(),
    currentTargetKey: "darwin-arm64",
    projectRoot: "/proj",
    bundleOutput: "/proj/dist/cli.bundle.cjs",
    binariesDir: "/binaries",
    ...overrides,
  };
  return { deps, calls };
}

describe("resolveTargets", () => {
  it("resolves --target to exactly that key", () => {
    expect(resolveTargets(["--target", "linux-x64"], "darwin-arm64")).toEqual(["linux-x64"]);
  });

  it("resolves --all to every target key", () => {
    expect(resolveTargets(["--all"], "darwin-arm64")).toEqual(Object.keys(TARGET_MAP));
  });

  it("resolves --macos-universal to both mac arches", () => {
    expect(resolveTargets(["--macos-universal"], "linux-x64")).toEqual([
      "darwin-arm64",
      "darwin-x64",
    ]);
  });

  it("defaults to the current platform", () => {
    expect(resolveTargets([], "win32-x64")).toEqual(["win32-x64"]);
  });

  it.each([
    [["--target"], "--target requires a value"],
    [["--target", "--all"], "--target requires a value"],
    [["--target", "bogus"], "Unknown target: bogus"],
    [["--all", "--macos-universal"], "only one of"],
    [["--tagret", "darwin-arm64"], "Unknown argument"],
    [["--all", "extra"], "Unknown argument"],
    [["--all", "--all"], "Duplicate argument"],
    [["--target", "darwin-arm64", "--target", "darwin-arm64"], "Duplicate argument"],
    [["--target", "linux-x64", "linux-x64"], "Unknown argument"],
    [["linux-x64", "--target", "linux-x64"], "Unknown argument"],
  ])("rejects malformed args %j", (argv, message) => {
    expect(() => resolveTargets(argv as string[], "darwin-arm64")).toThrow(message);
  });

  it("rejects an unsupported current platform", () => {
    expect(() => resolveTargets([], "sunos-sparc")).toThrow("Unsupported platform");
  });
});

describe("meaningfulStderr", () => {
  it("drops the Done line but keeps warnings", () => {
    expect(meaningfulStderr("warning: something odd\nDone in 32ms\n")).toBe(
      "warning: something odd"
    );
    expect(meaningfulStderr("Done in 5ms\n")).toBe("");
  });
});

describe("buildForTarget", () => {
  it("packages to a staging path and renames over the destination (atomic)", async () => {
    const order: string[] = [];
    const { deps } = makeDeps({
      rm: vi.fn(async () => {
        order.push("rm-staging");
      }),
      runTool: vi.fn(async () => {
        order.push("pkg");
        return { stdout: "", stderr: "" };
      }),
      rename: vi.fn(async () => {
        order.push("rename");
      }),
    });

    expect(await buildForTarget("darwin-arm64", deps)).toBe(true);
    // Old artifact is never deleted before the new one is verified.
    expect(order).toEqual(["rm-staging", "pkg", "rename"]);
    expect(deps.rename).toHaveBeenCalledWith(
      expect.stringContaining(".staging"),
      expect.stringMatching(/vmark-mcp-server-aarch64-apple-darwin$/)
    );
  });

  it("keeps the previous artifact when packaging fails (no rename)", async () => {
    const { deps } = makeDeps({
      runTool: vi.fn(async () => {
        throw new Error("pkg exploded");
      }),
    });
    expect(await buildForTarget("darwin-arm64", deps)).toBe(false);
    expect(deps.rename).not.toHaveBeenCalled();
  });

  it("removes the partial .staging binary after a failed build", async () => {
    const rm = vi.fn(async (..._args: unknown[]) => undefined);
    const { deps } = makeDeps({
      rm,
      runTool: vi.fn(async () => {
        throw new Error("pkg exploded");
      }),
    });
    expect(await buildForTarget("darwin-arm64", deps)).toBe(false);
    // First rm clears stale staging pre-build; the failure path must rm again.
    const stagingCalls = rm.mock.calls.filter(
      (args) => typeof args[0] === "string" && (args[0] as string).includes(".staging")
    );
    expect(stagingCalls.length).toBe(2);
  });

  it("still returns false when the failure-path staging cleanup itself throws", async () => {
    let calls = 0;
    const rm = vi.fn(async (..._args: unknown[]) => {
      calls += 1;
      if (calls > 1) throw new Error("EPERM");
    });
    const { deps } = makeDeps({
      rm,
      runTool: vi.fn(async () => {
        throw new Error("pkg exploded");
      }),
    });
    expect(await buildForTarget("darwin-arm64", deps)).toBe(false);
  });

  it("keeps the .exe extension TERMINAL on the Windows staging path", async () => {
    // pkg appends .exe to extensionless Windows outputs; a suffix after the
    // extension made pkg write a different file than verify checked.
    const { deps } = makeDeps();
    expect(await buildForTarget("win32-x64", deps)).toBe(true);
    const pkgArgs = (deps.runTool as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[0] as string[])[0] === "@yao-pkg/pkg"
    )?.[0] as string[];
    const out = pkgArgs[pkgArgs.indexOf("--output") + 1];
    expect(out).toMatch(/vmark-mcp-server-x86_64-pc-windows-msvc\.staging-[^.]+\.exe$/);
    expect(deps.rename).toHaveBeenCalledWith(
      expect.stringMatching(/\.staging-[^.]+\.exe$/),
      expect.stringMatching(/vmark-mcp-server-x86_64-pc-windows-msvc\.exe$/)
    );
  });

  it("returns false when the artifact is missing after pkg", async () => {
    const { deps } = makeDeps({
      access: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
    });
    expect(await buildForTarget("darwin-arm64", deps)).toBe(false);
  });

  it("returns false for an unknown target key", async () => {
    const { deps } = makeDeps();
    expect(await buildForTarget("bogus", deps)).toBe(false);
  });
});

describe("runBuild", () => {
  it("builds sequentially and throws on partial --all failure", async () => {
    const { deps, calls } = makeDeps({
      runTool: vi.fn(async (args: string[]) => {
        if (args[0] === "esbuild") {
          calls.push("esbuild");
          return { stdout: "", stderr: "" };
        }
        const target = args[args.indexOf("--target") + 1];
        calls.push(`pkg:${target}`);
        if (target === `${NODE_RUNTIME}-win-x64`) throw new Error("pkg exploded");
        return { stdout: "", stderr: "" };
      }),
    });

    await expect(runBuild(["--all"], deps)).rejects.toThrow("Failed targets: win32-x64");
    // Sequential: esbuild once, then one pkg per target in TARGET_MAP order.
    expect(calls[0]).toBe("esbuild");
    expect(calls.slice(1)).toEqual(
      Object.values(TARGET_MAP).map((t) => `pkg:${t.pkg}`)
    );
  });

  it("cleans the bundle up even when the build fails", async () => {
    const { deps } = makeDeps({
      runTool: vi.fn(async (args: string[]) => {
        if (args[0] === "esbuild") return { stdout: "", stderr: "" };
        throw new Error("pkg exploded");
      }),
    });

    await expect(runBuild([], deps)).rejects.toThrow("Failed targets");
    expect(deps.rm).toHaveBeenCalledWith("/proj/dist/cli.bundle.cjs", { force: true });
  });

  it("succeeds end-to-end for the current platform", async () => {
    const { deps, calls } = makeDeps();
    await runBuild([], deps);
    expect(calls).toEqual(["esbuild", `pkg:${NODE_RUNTIME}-macos-arm64`]);
  });
});

describe("resolveBinScript", () => {
  const deps = {
    resolvePkgJson: (name: string) => `/repo/node_modules/${name}/package.json`,
    readJson: (path: string) =>
      path.includes("esbuild")
        ? { bin: { esbuild: "bin/esbuild" } }
        : { bin: "lib-es5/bin.js" },
  };

  it("resolves an object bin entry relative to the package", () => {
    expect(resolveBinScript(deps, "esbuild", "esbuild")).toBe(
      "/repo/node_modules/esbuild/bin/esbuild"
    );
  });

  it("resolves a string bin declaration", () => {
    expect(resolveBinScript(deps, "@yao-pkg/pkg", "pkg")).toBe(
      "/repo/node_modules/@yao-pkg/pkg/lib-es5/bin.js"
    );
  });

  it("throws when the package declares no matching bin", () => {
    const noBin = { ...deps, readJson: () => ({}) };
    expect(() => resolveBinScript(noBin, "esbuild", "esbuild")).toThrow("does not declare");
  });
});

describe("runBuild cleanup propagation", () => {
  it("fails an otherwise-successful run when bundle cleanup throws", async () => {
    const { deps } = makeDeps({
      rm: vi.fn(async (path: string) => {
        if (path === "/proj/dist/cli.bundle.cjs") throw new Error("EPERM");
      }),
    });
    await expect(runBuild([], deps)).rejects.toThrow("EPERM");
  });

  it("does not mask a build failure with the cleanup error", async () => {
    const { deps } = makeDeps({
      runTool: vi.fn(async (args: string[]) => {
        if (args[0] === "esbuild") return { stdout: "", stderr: "" };
        throw new Error("pkg exploded");
      }),
      rm: vi.fn(async (path: string) => {
        if (path === "/proj/dist/cli.bundle.cjs") throw new Error("EPERM");
      }),
    });
    await expect(runBuild([], deps)).rejects.toThrow("Failed targets");
  });
});
