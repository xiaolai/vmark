// @vitest-environment node
// WI-AL3.2 — the frozen R64 comment receipt fixtures, read from the Rust tree, decode in the client: each stored commentCreated and commentReplied response parses through the production decoder and re-serializes byte for byte inside its receipt (decimal generations past 2^53 kept as strings); each digest is SHA-256 over the exact payload bytes; and the client freezes each payload byte-identical from its fields, requestId and page identity
import { describe, it, expect, vi } from "vitest";
vi.unmock("@/services/agentJournal/journalTransport");
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { freezePreparePayload } from "../../journalIpc";
import { parseCommentCreated, parseCommentReplied } from "../commentReplies";

interface Fixtures {
  receipts: Array<{ name: string; payload: string; receipt: string }>;
}

const FIXTURES = resolve(import.meta.dirname, "../../../../../src-tauri/src/agent_journal/fixtures/comment_receipts.json");
const fixtures = JSON.parse(readFileSync(FIXTURES, "utf8")) as Fixtures;
const sha256 = (text: string) => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

const DECODERS: Record<string, (r: unknown) => unknown> = {
  commentCreated: (r) => parseCommentCreated("comment_user_create", r),
  commentReplied: (r) => parseCommentReplied("comment_user_reply", r),
};

type Receipt = { requestId: string; digest: string; outcome: { kind: string; response: unknown } };
const cases = fixtures.receipts.map((f) => [f.name, f] as const);

describe("comment receipt fixtures", () => {
  it("covers exactly the created and replied receipts", () => {
    expect(fixtures.receipts.map((f) => f.name).sort()).toEqual(Object.keys(DECODERS).sort());
  });

  it.each(cases)("%s: the response decodes losslessly", (name, f) => {
    const receipt = JSON.parse(f.receipt) as Receipt;
    expect(receipt.outcome.kind).toBe(name);
    const decoded = DECODERS[name](receipt.outcome.response);
    expect(f.receipt.endsWith(`"response":${JSON.stringify(decoded)}}}`)).toBe(true);
  });

  it.each(cases)("%s: digest is SHA-256 of the raw payload", (_name, f) => {
    const receipt = JSON.parse(f.receipt) as Receipt;
    expect(receipt.digest).toBe(sha256(f.payload));
    expect((JSON.parse(f.payload) as { requestId: string }).requestId).toBe(receipt.requestId);
  });

  it.each(cases)("%s: the client freezes the same payload bytes", (_name, f) => {
    const { requestId, incarnation, webviewGeneration, pageIdentity, ...fields } = JSON.parse(f.payload) as Record<string, string>;
    expect(freezePreparePayload(fields, requestId, { incarnation, webviewGeneration, pageIdentity })).toBe(f.payload);
  });
});
