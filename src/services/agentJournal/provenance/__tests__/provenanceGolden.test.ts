// @vitest-environment node
// WI-AL1.4 — the TypeScript provenance accumulator and payload reproduce the shared golden vectors byte for byte (the same fixture the Rust writer's golden tests read): composed boundary maps, bounded and whole breaks, cap overflow, mapped spans, payload encoding with SHA-256 hashes, decode refusals and the surviving-character text check
import { describe, it, expect } from "vitest";
import fixture from "@/test/fixtures/agentJournal/provenance.json";
import { Provenance, PROVENANCE_CAP } from "../accumulator";
import { decodePayload, encodePayload, textHash, verifyPayloadTexts } from "../payload";
import { mapSpan } from "./spanMapping";

type Section = { fromA: number; toA: number; fromB: number; toB: number; insert: string };
type Txn =
  | { kind: "certified"; sections: Section[] }
  | { kind: "breakRange"; fromA: number; toA: number; insert: string; reason: string; origin: string }
  | { kind: "breakWhole"; text: string; reason: string; origin: string };
interface Case {
  name: string;
  cap: number;
  pre: string;
  post: string;
  transactions: Txn[];
  payload: { document: string; epoch: string; basis: string } & Record<string, unknown>;
  spans?: { input: { from: number; to: number; growing: boolean }; expect: unknown }[];
}

function run(c: Case): Provenance {
  const p = new Provenance(c.pre.length, { cap: c.cap });
  for (const t of c.transactions) {
    if (t.kind === "certified") p.compose(t.sections);
    else if (t.kind === "breakRange") p.breakRange(t.fromA, t.toA, t.insert.length, t.reason, t.origin);
    else p.breakWhole(t.text.length, t.reason, t.origin);
  }
  return p;
}

const cases = [...(fixture.cases as unknown as Case[]), ...(fixture.writerCases as unknown as Case[])];

describe("provenance golden parity", () => {
  it("declares the same cap as the fixture", () => {
    expect(PROVENANCE_CAP).toBe(fixture.maxCap);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s: encodes the golden payload", async (_n, c) => {
    const p = run(c);
    const { document, epoch, basis } = c.payload;
    const payload = await encodePayload({ document, epoch, basis, pre: c.pre, post: c.post, provenance: p });
    expect(payload).toEqual(c.payload);
  });

  it.each(cases.filter((c) => c.spans).map((c) => [c.name, c] as const))("%s: maps spans", (_n, c) => {
    const p = run(c);
    for (const s of c.spans ?? []) expect(mapSpan(p, s.input)).toEqual(s.expect);
  });

  it.each(fixture.invalid.map((c) => [c.name, c] as const))("%s: refused on decode", async (_n, c) => {
    expect(() => decodePayload(c.payload)).toThrow();
  });

  it.each(fixture.textChecks.map((c) => [c.name, c] as const))("%s: text check", async (_n, c) => {
    const check = () => verifyPayloadTexts(c.payload, c.pre, c.post);
    if (c.valid) await expect(check()).resolves.toBeInstanceOf(Provenance);
    else await expect(check()).rejects.toThrow();
  });

  it("refuses a lone surrogate when hashing (well-formed text only)", async () => {
    await expect(textHash("a\ud800")).rejects.toThrow(/well-formed/);
  });

  it("refuses an encode whose lengths do not match the texts", async () => {
    const p = new Provenance(3);
    await expect(encodePayload({ document: "d", epoch: "1", basis: "b", pre: "ab", post: "abc", provenance: p })).rejects.toThrow(/lengths/);
  });

  it("refuses malformed sections, unknown reasons and out-of-range breaks", () => {
    const p = new Provenance(3);
    expect(() => p.compose([{ fromA: 2, toA: 1, fromB: 2, toB: 1 }])).toThrow(/malformed/);
    expect(() => p.compose([{ fromA: 0, toA: 4, fromB: 0, toB: 4 }])).toThrow(/malformed/);
    expect(() => p.breakWhole(1, "bogus", "x")).toThrow(/reason/);
    expect(() => p.breakWhole(1, "snapshotOnly", "")).toThrow(/origin/);
    expect(() => p.breakRange(0, 9, 0, "uncertifiedRange", "x")).toThrow(/malformed/);
  });

  it("keeps an empty document empty and certifies it", async () => {
    const p = new Provenance(0);
    const payload = await encodePayload({ document: "d", epoch: "1", basis: "genesis", pre: "", post: "", provenance: p });
    await expect(verifyPayloadTexts(payload, "", "")).resolves.toBeInstanceOf(Provenance);
  });
});
