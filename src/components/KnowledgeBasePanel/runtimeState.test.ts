// @vitest-environment node
// WI-FL1.1 — pure mapping from the runtime probe to what the panel tells the user.
import { describe, expect, it } from "vitest";
import type { ContentServerRuntime } from "@/services/contentServer";
import {
  RUNTIME_KEYS,
  isContentServerRuntime,
  isRuntimeReady,
  runtimeMissingKeys,
} from "./runtimeState";

const READY: ContentServerRuntime = {
  node: "ready",
  nodePath: "/usr/local/bin/node",
  cli: "ready",
  cliSource: "provisioned",
  detail: null,
};
const withState = (over: Partial<ContentServerRuntime>): ContentServerRuntime => ({
  ...READY,
  ...over,
});

describe("isRuntimeReady", () => {
  it.each([
    { node: "ready", cli: "ready", expected: true },
    { node: "missing", cli: "ready", expected: false },
    { node: "ready", cli: "missing", expected: false },
    { node: "missing", cli: "missing", expected: false },
  ] as const)("node=$node cli=$cli → $expected", ({ node, cli, expected }) => {
    expect(isRuntimeReady(withState({ node, cli }))).toBe(expected);
  });
});

describe("runtimeMissingKeys", () => {
  it("is empty when both halves are ready, in either build", () => {
    expect(runtimeMissingKeys(READY, true)).toEqual([]);
    expect(runtimeMissingKeys(READY, false)).toEqual([]);
  });

  it("names Node.js when node is missing, regardless of build", () => {
    const rt = withState({ node: "missing", nodePath: null });
    expect(runtimeMissingKeys(rt, true)).toEqual([RUNTIME_KEYS.nodeMissing]);
    expect(runtimeMissingKeys(rt, false)).toEqual([RUNTIME_KEYS.nodeMissing]);
  });

  it("a missing CLI in a packaged build is 'not included in this build'", () => {
    const rt = withState({ cli: "missing", cliSource: null });
    expect(runtimeMissingKeys(rt, false)).toEqual([RUNTIME_KEYS.cliMissingPackaged]);
  });

  it("a missing CLI in development points at the env override or a provisioned base-kb", () => {
    const rt = withState({ cli: "missing", cliSource: null });
    expect(runtimeMissingKeys(rt, true)).toEqual([RUNTIME_KEYS.cliMissingDev]);
  });

  it("lists the CLI before Node when both are missing", () => {
    const rt = withState({ node: "missing", nodePath: null, cli: "missing", cliSource: null });
    expect(runtimeMissingKeys(rt, false)).toEqual([
      RUNTIME_KEYS.cliMissingPackaged,
      RUNTIME_KEYS.nodeMissing,
    ]);
    expect(runtimeMissingKeys(rt, true)).toEqual([
      RUNTIME_KEYS.cliMissingDev,
      RUNTIME_KEYS.nodeMissing,
    ]);
  });

  it("every key is a flat contentServer.runtime.* key", () => {
    for (const key of Object.values(RUNTIME_KEYS)) {
      expect(key).toMatch(/^contentServer\.runtime\.[a-zA-Z]+$/);
    }
  });
});

describe("isContentServerRuntime", () => {
  it("accepts the wire shape", () => {
    expect(isContentServerRuntime(READY)).toBe(true);
    expect(
      isContentServerRuntime({ node: "missing", nodePath: null, cli: "missing", cliSource: null, detail: "x" }),
    ).toBe(true);
  });

  it.each([undefined, null, "ready", 42, {}, { node: "ready" }, { node: "yes", cli: "ready" }, []])(
    "rejects %j",
    (value) => {
      expect(isContentServerRuntime(value)).toBe(false);
    },
  );

  // Audit 20260907 (#321): the guard checked `node` and `cli` only, so
  // `{node:"ready", cli:"ready"}` passed with every other required field
  // missing — the malformed-payload gate it exists to be, defeated.
  it.each([
    ["the two state fields alone", { node: "ready", cli: "ready" }],
    ["nodePath missing", { ...READY, nodePath: undefined }],
    ["nodePath of the wrong type", { ...READY, nodePath: 5 }],
    ["cliSource missing", { ...READY, cliSource: undefined }],
    ["cliSource outside the union", { ...READY, cliSource: "weird" }],
    ["detail missing", { ...READY, detail: undefined }],
    ["detail of the wrong type", { ...READY, detail: {} }],
  ])("rejects a payload with %s", (_label, value) => {
    expect(isContentServerRuntime(value)).toBe(false);
  });

  it("accepts every cliSource a READY cli can carry", () => {
    for (const cliSource of ["env", "bundled", "provisioned"] as const) {
      expect(isContentServerRuntime({ ...READY, cliSource })).toBe(true);
    }
  });

  // Audit R2 (#633): `classify` derives the state and its source from one
  // match arm, so these pairings cannot come from this backend — and trusting
  // the "ready" half of one is the partial-report hole above, respelled.
  it.each([
    ["a ready cli with no source", { ...READY, cliSource: null }],
    ["a missing cli that still names a source", { ...READY, cli: "missing" }],
    ["ready node with no path", { ...READY, nodePath: null }],
    ["a missing node that still has a path", { ...READY, node: "missing" }],
  ])("rejects %s", (_label, value) => {
    expect(isContentServerRuntime(value)).toBe(false);
  });
});
