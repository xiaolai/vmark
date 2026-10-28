// @vitest-environment node
// The provenance payload producer and decoder refuse exactly what the journal's Rust decoder refuses (agent_journal/provenance/payload.rs, body.rs): a cap below four, a map whose L(0) is not 0 (untracked leading text), a map whose R(lenA) is not lenB (untracked trailing text), and an oversized body refused on its size before it is rebuilt
import { describe, it, expect } from "vitest";
import { MIN_PROVENANCE_CAP, PROVENANCE_CAP, Provenance, type ProvenanceBody } from "../accumulator";
import { decodePayload, encodePayload, type ProvenancePayload } from "../payload";

const IDS = { document: "d", epoch: "1", basis: "b" };

/** "abcd" → "a中文cd": a certified two-unit insertion. */
function edited(cap = PROVENANCE_CAP): Provenance {
  return new Provenance(4, { cap }).compose([{ fromA: 1, toA: 2, fromB: 1, toB: 3 }]);
}

async function payload(): Promise<ProvenancePayload> {
  return encodePayload({ ...IDS, pre: "abcd", post: "a中文cd", provenance: edited() });
}

describe("provenance cap floor", () => {
  it("declares the journal's minimum cap", () => {
    expect(MIN_PROVENANCE_CAP).toBe(4);
  });

  it.each([0, 1, 2, 3, PROVENANCE_CAP + 1, 4.5])("refuses to build an accumulator with cap %s", (cap) => {
    expect(() => new Provenance(4, { cap })).toThrow(/cap/);
  });

  it.each([4, PROVENANCE_CAP])("accepts cap %s and encodes it", async (cap) => {
    const p = await encodePayload({ ...IDS, pre: "abcd", post: "a中文cd", provenance: edited(cap) });
    expect(p.cap).toBe(cap);
    expect(decodePayload(p).cap).toBe(cap);
  });

  it("refuses to encode an accumulator whose cap was tampered below four", async () => {
    const p = edited();
    Object.defineProperty(p, "cap", { value: 3 });
    await expect(encodePayload({ ...IDS, pre: "abcd", post: "a中文cd", provenance: p })).rejects.toThrow(/cap/);
  });

  it.each([1, 2, 3])("refuses to decode cap %s", async (cap) => {
    const p = { ...(await payload()), cap };
    expect(() => decodePayload(p)).toThrow(/cap/);
  });
});

describe("provenance map endpoints", () => {
  it("refuses to encode an accumulator whose L(0) is not 0 (leading text unaccounted for)", async () => {
    const p = edited();
    p.Lp = p.Lp.map((x) => ({ ...x, o: x.o + 1 }));
    p.Rp = p.Rp.map((x) => ({ ...x, o: x.o + 1 }));
    p.lenB += 1;
    await expect(encodePayload({ ...IDS, pre: "abcd", post: "Xa中文cd", provenance: p })).rejects.toThrow(/L\(0\)/);
  });

  it("refuses to encode an accumulator whose R(lenA) is short of lenB (trailing text unaccounted for)", async () => {
    const p = edited();
    p.lenB += 1;
    await expect(encodePayload({ ...IDS, pre: "abcd", post: "a中文cdX", provenance: p })).rejects.toThrow(/R\(lenA\)/);
  });

  it("refuses to decode a hostile leading prefix", async () => {
    const good = await payload();
    const body: ProvenanceBody = { ...good.body, lenB: good.body.lenB + 1, map: { ...good.body.map, L0: 1, R0: 1 } };
    expect(() => decodePayload({ ...good, body })).toThrow(/L\(0\)/);
  });

  it("refuses to decode a hostile trailing suffix", async () => {
    const good = await payload();
    const body: ProvenanceBody = { ...good.body, lenB: good.body.lenB + 1 };
    expect(() => decodePayload({ ...good, body })).toThrow(/R\(lenA\)/);
  });

  it("still decodes the untouched and the empty document", async () => {
    const same = await encodePayload({ ...IDS, pre: "abc", post: "abc", provenance: new Provenance(3) });
    expect(decodePayload(same).lenB).toBe(3);
    const empty = await encodePayload({ ...IDS, pre: "", post: "", provenance: new Provenance(0) });
    expect(decodePayload(empty).lenB).toBe(0);
  });
});

describe("body size preflight", () => {
  it("refuses an oversized body on its size alone, before rebuilding it", async () => {
    const good = await payload();
    // Malformed AND oversized: the size refusal must win, so nothing was rebuilt first.
    const deletedChars = Array.from({ length: 9 }, () => [9, 1] as [number, number]);
    const body: ProvenanceBody = { ...good.body, map: { L0: 0, R0: 0, runs: [[1, 1, 1], [1, 1, 1]] }, deletedChars };
    expect(() => decodePayload({ ...good, cap: 4, body })).toThrow(/exceeds its cap/);
  });

  it("refuses a body that is not an object before counting its entries", async () => {
    const good = await payload();
    expect(() => decodePayload({ ...good, body: null })).toThrow(/malformed/);
    expect(() => decodePayload({ ...good, body: { ...good.body, map: { L0: 0, R0: 0, runs: 7 } } })).toThrow(/malformed/);
  });
});

describe("payload epoch", () => {
  it.each(["0", "18446744073709551615"])("accepts the decimal u64 %s", async (epoch) => {
    expect(decodePayload({ ...(await payload()), epoch }).lenB).toBe(5);
  });

  it.each([
    ["one past u64::MAX", "18446744073709551616"],
    ["a padded value", "01"],
    ["a sign", "-1"],
    ["a number", 1],
    // Refused on its length, without an arbitrary-precision parse.
    ["a million digits", "9".repeat(1_000_000)],
  ])("refuses %s", async (_label, epoch) => {
    const good = await payload();
    expect(() => decodePayload({ ...good, epoch })).toThrow(/malformed epoch/);
  });
});
