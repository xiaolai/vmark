// @vitest-environment node
// withRowPlans — pure patch planning for StepForm's `with:` rows.
// Codex audit findings: (1) rename chains a→b→c leaked the intermediate
// set(b) into the queue; (2) two rows committing the same key silently
// collapsed via last-write-wins dedup while the UI showed both.

import { describe, expect, it } from "vitest";
import type { StepIR } from "@/lib/ghaWorkflow/types";
import {
  newWithRow,
  planWithRowCommit,
  planWithRowRemoval,
  withRowsFromStep,
  type WithRow,
} from "../withRowPlans";

const ctx = { jobId: "build", stepIndex: 0 };

function row(overrides: Partial<WithRow> = {}): WithRow {
  return {
    key: "",
    value: "",
    originalKey: null,
    committedKey: null,
    duplicateKey: false,
    ...overrides,
  };
}

/** Other-row claims: current key only (nothing committed). */
const claims = (...keys: string[]) =>
  keys.map((key) => ({ key, committedKey: null }));

const setPatch = (key: string, value: string) =>
  ({ kind: "with.set", jobId: "build", stepIndex: 0, key, value }) as const;
const removePatch = (key: string) =>
  ({ kind: "with.remove", jobId: "build", stepIndex: 0, key }) as const;
/** Cancel targets match by (jobId, stepIndex, key); value is ignored. */
const cancelSet = (key: string) => setPatch(key, "");

function makeStep(withBlock?: Record<string, string>): StepIR {
  return {
    id: "checkout",
    idSynthesized: false,
    name: "Checkout",
    uses: "actions/checkout@v4",
    with: withBlock,
    position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
  };
}

describe("withRowsFromStep", () => {
  it("maps with: entries to rows with commit-tracking defaults", () => {
    const rows = withRowsFromStep(makeStep({ "node-version": "20" }));
    expect(rows).toEqual([
      {
        key: "node-version",
        value: "20",
        originalKey: "node-version",
        committedKey: null,
        duplicateKey: false,
      },
    ]);
  });

  it("returns [] when the step has no with: block", () => {
    expect(withRowsFromStep(makeStep())).toEqual([]);
  });

  it("stringifies non-string values and maps null to empty string", () => {
    const step = makeStep();
    step.with = { depth: 0 as unknown as string, token: null as unknown as string };
    const rows = withRowsFromStep(step);
    expect(rows[0].value).toBe("0");
    expect(rows[1].value).toBe("");
  });
});

describe("newWithRow", () => {
  it("creates an empty uncommitted row", () => {
    expect(newWithRow()).toEqual(row());
  });

  it("creates a keyed uncommitted row for suggested keys", () => {
    expect(newWithRow("cache")).toEqual(row({ key: "cache" }));
  });
});

describe("planWithRowCommit — no-ops", () => {
  it("is a noop for an empty key", () => {
    const plan = planWithRowCommit(ctx, row({ value: "v" }), [], undefined);
    expect(plan).toEqual({ kind: "noop" });
  });

  it("is a noop for a whitespace-only key", () => {
    const plan = planWithRowCommit(ctx, row({ key: "   " }), [], undefined);
    expect(plan).toEqual({ kind: "noop" });
  });
});

describe("planWithRowCommit — duplicate keys (finding 2)", () => {
  it("rejects a key already held by another row instead of queueing", () => {
    const plan = planWithRowCommit(
      ctx,
      row({ key: "cache", value: "npm" }),
      claims("node-version", "cache"),
      undefined,
    );
    expect(plan.kind).toBe("duplicate");
  });

  it("compares keys trimmed", () => {
    const plan = planWithRowCommit(
      ctx,
      row({ key: " cache ", value: "npm" }),
      claims("cache"),
      undefined,
    );
    expect(plan.kind).toBe("duplicate");
  });

  it("cancels this row's previously committed set so an invalid row leaves no queued patches", () => {
    const plan = planWithRowCommit(
      ctx,
      row({ key: "cache", value: "npm", committedKey: "tmp" }),
      claims("cache"),
      undefined,
    );
    expect(plan).toEqual({ kind: "duplicate", cancels: [cancelSet("tmp")] });
  });

  it("also cancels patches under the original key for a renamed pre-existing row", () => {
    const plan = planWithRowCommit(
      ctx,
      row({ key: "cache", value: "20", originalKey: "nv", committedKey: "tmp" }),
      claims("cache"),
      { nv: "20" },
    );
    expect(plan).toEqual({
      kind: "duplicate",
      cancels: [cancelSet("tmp"), cancelSet("nv")],
    });
  });

  it("does not treat empty sibling keys as duplicates of each other", () => {
    const plan = planWithRowCommit(ctx, row({ key: "k" }), claims(""), undefined);
    expect(plan.kind).toBe("patches");
  });
});

describe("planWithRowCommit — pre-existing rows", () => {
  const stepWith = { "node-version": "20" };

  it("queues a set when the value changed", () => {
    const plan = planWithRowCommit(
      ctx,
      row({ key: "node-version", value: "22", originalKey: "node-version" }),
      [],
      stepWith,
    );
    expect(plan).toEqual({
      kind: "patches",
      cancels: [],
      queues: [setPatch("node-version", "22")],
      committedKey: "node-version",
    });
  });

  it("cancels the queued set when the value reverts to the IR original", () => {
    const plan = planWithRowCommit(
      ctx,
      row({
        key: "node-version",
        value: "20",
        originalKey: "node-version",
        committedKey: "node-version",
      }),
      [],
      stepWith,
    );
    expect(plan).toEqual({
      kind: "patches",
      cancels: [cancelSet("node-version")],
      queues: [],
      committedKey: null,
    });
  });

  it("queues remove(original)+set(new) on a rename", () => {
    const plan = planWithRowCommit(
      ctx,
      row({ key: "nv2", value: "20", originalKey: "node-version" }),
      [],
      stepWith,
    );
    expect(plan).toEqual({
      kind: "patches",
      cancels: [],
      queues: [removePatch("node-version"), setPatch("nv2", "20")],
      committedKey: "nv2",
    });
  });

  it("cancels the intermediate key's set on a rename chain a→b→c (finding 1)", () => {
    const plan = planWithRowCommit(
      ctx,
      row({ key: "c", value: "20", originalKey: "a", committedKey: "b" }),
      [],
      { a: "20" },
    );
    expect(plan).toEqual({
      kind: "patches",
      cancels: [cancelSet("b")],
      queues: [removePatch("a"), setPatch("c", "20")],
      committedKey: "c",
    });
  });

  it("renaming back to the original key cancels both the intermediate set and the original's remove", () => {
    const plan = planWithRowCommit(
      ctx,
      row({ key: "a", value: "20", originalKey: "a", committedKey: "b" }),
      [],
      { a: "20" },
    );
    expect(plan).toEqual({
      kind: "patches",
      cancels: [cancelSet("b"), cancelSet("a")],
      queues: [],
      committedKey: null,
    });
  });
});

describe("planWithRowCommit — new rows (originalKey null)", () => {
  it("queues a plain set on first commit", () => {
    const plan = planWithRowCommit(ctx, row({ key: "a", value: "1" }), [], undefined);
    expect(plan).toEqual({
      kind: "patches",
      cancels: [],
      queues: [setPatch("a", "1")],
      committedKey: "a",
    });
  });

  it("cancels the previous key's set on a new-row rename chain (finding 1)", () => {
    const plan = planWithRowCommit(
      ctx,
      row({ key: "b", value: "1", committedKey: "a" }),
      [],
      undefined,
    );
    expect(plan).toEqual({
      kind: "patches",
      cancels: [cancelSet("a")],
      queues: [setPatch("b", "1")],
      committedKey: "b",
    });
  });
});

describe("planWithRowRemoval", () => {
  it("queues only remove(original) for an unrenamed pre-existing row", () => {
    const plan = planWithRowRemoval(
      ctx,
      row({ key: "a", value: "1", originalKey: "a", committedKey: "a" }),
      [],
    );
    expect(plan).toEqual({ cancels: [], queues: [removePatch("a")] });
  });

  it("cancels the current key's set and keeps remove(original) for a renamed row", () => {
    const plan = planWithRowRemoval(
      ctx,
      row({ key: "c", value: "1", originalKey: "a", committedKey: "c" }),
      [],
    );
    expect(plan).toEqual({
      cancels: [cancelSet("c")],
      queues: [removePatch("a")],
    });
  });

  it("also cancels the last committed key when the current key was never committed (finding 1)", () => {
    const plan = planWithRowRemoval(
      ctx,
      row({ key: "c", value: "1", originalKey: "a", committedKey: "b" }),
      [],
    );
    expect(plan).toEqual({
      cancels: [cancelSet("c"), cancelSet("b")],
      queues: [removePatch("a")],
    });
  });

  it("cancels both keys and queues nothing for a chain-renamed new row", () => {
    const plan = planWithRowRemoval(
      ctx,
      row({ key: "c", value: "1", committedKey: "b" }),
      [],
    );
    expect(plan).toEqual({ cancels: [cancelSet("c"), cancelSet("b")], queues: [] });
  });

  it("queues and cancels nothing for an untouched empty new row", () => {
    const plan = planWithRowRemoval(ctx, row(), []);
    expect(plan).toEqual({ cancels: [], queues: [] });
  });
});

describe("cross-row target ownership (verify regression C2)", () => {
  it("duplicate commit never cancels a target another row committed under", () => {
    // Row X: originally "a", renamed+committed to "b"; user retypes "a".
    // Row Y committed set(a) in the meantime — Y owns target a now.
    const plan = planWithRowCommit(
      ctx,
      row({ key: "a", value: "1", originalKey: "a", committedKey: "b" }),
      [{ key: "a", committedKey: "a" }],
      { a: "0" },
    );
    expect(plan.kind).toBe("duplicate");
    // X's own set(b) is cancelled; Y's set(a) must survive.
    expect(plan.kind === "duplicate" && plan.cancels).toEqual([cancelSet("b")]);
  });

  it("rename-chain commit skips cancelling a committedKey another row now owns", () => {
    // X committed set(b), then Y committed set(b) (replacing X's patch, Y
    // owns target b). X now commits "c" — cancelling b would kill Y's patch.
    const plan = planWithRowCommit(
      ctx,
      row({ key: "c", value: "1", originalKey: "a", committedKey: "b" }),
      [{ key: "b", committedKey: "b" }],
      { a: "0" },
    );
    expect(plan.kind).toBe("patches");
    if (plan.kind !== "patches") return;
    expect(plan.cancels).toEqual([]);
    expect(plan.queues).toEqual([removePatch("a"), setPatch("c", "1")]);
  });

  it("removal neither cancels nor queues remove for a target another row owns", () => {
    // X (original "a") is removed while Y has committed set(a): Y's set must
    // survive, and no remove(a) may replace it — Y's value wins on save.
    const plan = planWithRowRemoval(
      ctx,
      row({ key: "a", value: "1", originalKey: "a", committedKey: "a" }),
      [{ key: "a", committedKey: "a" }],
    );
    expect(plan).toEqual({ cancels: [], queues: [] });
  });

  it("removal still cleans up when the other row merely typed the key without committing", () => {
    const plan = planWithRowRemoval(
      ctx,
      row({ key: "c", value: "1", originalKey: "a", committedKey: "c" }),
      [{ key: "c", committedKey: null }],
    );
    expect(plan).toEqual({
      cancels: [cancelSet("c")],
      queues: [removePatch("a")],
    });
  });
});

describe("commit queue guards (re-verify RV1)", () => {
  it("renamed commit skips remove(original) when another row took the key over", () => {
    // A renamed o→x earlier; B then committed set(o) (owns target o).
    // A commits again (value tweak): queueing remove(o) would replace B's set.
    const plan = planWithRowCommit(
      ctx,
      row({ key: "x", value: "2", originalKey: "o", committedKey: "x" }),
      [{ key: "o", committedKey: "o" }],
      { o: "1" },
    );
    expect(plan.kind).toBe("patches");
    if (plan.kind !== "patches") return;
    expect(plan.queues).toEqual([setPatch("x", "2")]);
  });

  it("renamed commit still queues remove(original) when nobody owns it", () => {
    const plan = planWithRowCommit(
      ctx,
      row({ key: "x", value: "2", originalKey: "o", committedKey: "x" }),
      [{ key: "unrelated", committedKey: null }],
      { o: "1" },
    );
    expect(plan.kind).toBe("patches");
    if (plan.kind !== "patches") return;
    expect(plan.queues).toEqual([removePatch("o"), setPatch("x", "2")]);
  });
});
