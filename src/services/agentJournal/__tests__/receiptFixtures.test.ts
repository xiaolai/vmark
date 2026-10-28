// @vitest-environment node
// WI-AL2.2a — the frozen R64 receipt fixtures, read from the Rust tree, decode in the client too: each stored prepared response (the agent write's, the restore's) parses through the production client decoder and re-serializes byte for byte inside its receipt; each digest is SHA-256 over the exact payload bytes; the client freezes each payload byte-identical from its fields and requestId; and two payloads with the same fields in another order are different requests to the digest | AL2.2g: the client appends the page identity after the requestId; the stored fixture bytes are unchanged and are the frozen payload's prefix | AL2.2b: the schema-4 revert receipts decode too — an applied revert's prepared reply (its UTF-16 patch and postimage hash) and a revert's recorded decision (kind decision)
import { describe, it, expect, vi } from "vitest";
vi.unmock("@/services/agentJournal/journalTransport");
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseControlledPrepared } from "../journalClient";
import { parseRestorePrepared } from "../historyClient";
import { freezePreparePayload } from "../journalIpc";
import { parseRevertDecided, parseRevertPrepared } from "../revertReplies";

interface Fixtures {
  receipts: Array<{ name: string; payload: string; receipt: string }>;
  fieldOrder: Array<{ payload: string; digest: string }>;
}

const FIXTURES = resolve(import.meta.dirname, "../../../../src-tauri/src/agent_journal/fixtures/receipts.json");
const fixtures = JSON.parse(readFileSync(FIXTURES, "utf8")) as Fixtures;
const sha256 = (text: string) => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

const DECODERS: Record<string, (r: unknown) => unknown> = {
  controlledPrepared: (r) => parseControlledPrepared("agent_journal_prepare", r),
  restorePrepared: (r) => parseRestorePrepared("agent_journal_restore_prepare", r),
  revertPrepared: (r) => parseRevertPrepared("agent_journal_revert_prepare", r),
  revertDecided: (r) => parseRevertDecided("agent_journal_revert_prepare", r),
};
const KINDS: Record<string, string> = { revertDecided: "decision" };

describe("receipt fixtures", () => {
  it("covers exactly the prepared variants and the revert decision", () => {
    expect(fixtures.receipts.map((f) => f.name).sort()).toEqual(Object.keys(DECODERS).sort());
  });

  it.each(fixtures.receipts.map((f) => [f.name, f] as const))("%s: the response decodes losslessly", (name, f) => {
    const receipt = JSON.parse(f.receipt) as { requestId: string; digest: string; outcome: { kind: string; response: unknown } };
    expect(receipt.outcome.kind).toBe(KINDS[name] ?? "prepared");
    const decoded = DECODERS[name](receipt.outcome.response);
    expect(f.receipt.endsWith(`"response":${JSON.stringify(decoded)}}}`)).toBe(true);
  });

  it.each(fixtures.receipts.map((f) => [f.name, f] as const))("%s: digest is SHA-256 of the raw payload", (_name, f) => {
    const receipt = JSON.parse(f.receipt) as { requestId: string; digest: string };
    expect(receipt.digest).toBe(sha256(f.payload));
    expect((JSON.parse(f.payload) as { requestId: string }).requestId).toBe(receipt.requestId);
  });

  // The stored payloads predate the page identity; the client appends it after
  // the requestId, so the fixture's bytes are the frozen payload's prefix.
  it.each(fixtures.receipts.map((f) => [f.name, f] as const))("%s: the client freezes the same payload bytes", (_name, f) => {
    const { requestId, ...fields } = JSON.parse(f.payload) as { requestId: string };
    const page = { incarnation: "0".repeat(31) + "1", webviewGeneration: "18446744073709551615", pageIdentity: "a".repeat(32) };
    const identity = `,"incarnation":"${page.incarnation}","webviewGeneration":"${page.webviewGeneration}","pageIdentity":"${page.pageIdentity}"}`;
    expect(freezePreparePayload(fields, requestId, page)).toBe(f.payload.slice(0, -1) + identity);
  });

  it("digests field order: equal fields, different bytes, different digests", () => {
    const [a, b] = fixtures.fieldOrder;
    expect(JSON.parse(a.payload)).toEqual(JSON.parse(b.payload));
    expect([sha256(a.payload), sha256(b.payload)]).toEqual([a.digest, b.digest]);
    expect(a.digest).not.toBe(b.digest);
  });
});
