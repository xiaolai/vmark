/** Type declarations for build-sidecar-core.mjs (consumed by the test suite). */

export interface SidecarTarget {
  triple: string;
  pkg: string;
  ext?: string;
}

export interface BuildDeps {
  runTool: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
  mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<unknown>;
  rm: (path: string, opts?: { force?: boolean }) => Promise<unknown>;
  access: (path: string) => Promise<unknown>;
  rename: (from: string, to: string) => Promise<unknown>;
  log: (...parts: unknown[]) => void;
  error: (...parts: unknown[]) => void;
  currentTargetKey: string;
  projectRoot: string;
  bundleOutput: string;
  binariesDir: string;
  runId?: string;
}

export interface BinResolveDeps {
  resolvePkgJson: (pkgName: string) => string;
  readJson: (path: string) => { bin?: string | Record<string, string> };
}

export declare const NODE_RUNTIME: string;
export declare const TARGET_MAP: Record<string, SidecarTarget>;
export declare function resolveTargets(
  args: string[],
  currentTargetKey: string,
  log?: (...parts: unknown[]) => void
): string[];
export declare function resolveBinScript(
  deps: BinResolveDeps,
  pkgName: string,
  binName: string
): string;
export declare function meaningfulStderr(stderr: string): string;
export declare function bundleWithEsbuild(deps: BuildDeps): Promise<void>;
export declare function buildForTarget(targetKey: string, deps: BuildDeps): Promise<boolean>;
export declare function runBuild(argv: string[], deps: BuildDeps): Promise<void>;
