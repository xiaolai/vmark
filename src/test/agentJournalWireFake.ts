/**
 * Test helper — the agent edit journal's wire, answered by the in-memory
 * fake (`agentJournalFake.ts`): the transport the real IPC client, page
 * registration and request coordinator run over, so every app test exercises
 * the frozen payload, the bound replies and the request answers the Rust
 * commands send.
 *
 * Key decisions:
 *   - Registration always answers, echoing the identity sent. A prepare's
 *     payload is decoded, its identity fields checked present and stripped,
 *     and the rest handed to the fake's `prepareControlledWrite` spy; its
 *     reply is bound to the request id and the SHA-256 of the payload. A
 *     refusal is a request answer `notAdmitted` (`uncertain: false`), except
 *     an unavailable journal, which answers with no request echo, as the
 *     Rust command does when its writer is off.
 *   - Commit and abort are bound to the txn and pair they named; the page
 *     pair is not validated here. Abandon answers `fenced`.
 *   - A call-bound command (`CALL_BOUND`) must carry a well-formed
 *     `callId`, as the Rust command requires; it is stripped before the
 *     command is answered and echoed around the reply, so a test's
 *     `invoke` mock and assertions see the arguments without it.
 *   - Any other command (a restore's prepare, the history panel's reads)
 *     falls through to the global `invoke` mock; `answerPrepare` and
 *     `boundRestoreReply` build a restore prepare's answer for a test that
 *     scripts it.
 *
 * Use: the global setup mocks `@/services/agentJournal/journalTransport`
 * with `journalTransportModule()`; drive `agentJournalFake` from the test.
 * A client test that scripts raw replies mocks it with
 * `callBindingTransportModule()` instead.
 *
 * @module test/agentJournalWireFake
 */

import { vi } from "vitest";
import { JournalRefusal } from "@/services/agentJournal/journalRefusal";
import type { JournalAbortReason, PrepareInput } from "@/services/agentJournal/journalClient";
import { agentJournalFake as fake } from "./agentJournalFake";

type Args = Record<string, unknown>;

const IDENTITY = ["requestId", "incarnation", "webviewGeneration", "pageIdentity"] as const;
const INCARNATION = "00000000000000000000000000000001";
let generation = 0;

const isRecord = (v: unknown): v is Args => typeof v === "object" && v !== null;

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A CommandError-shaped rejection carrying `detail`. */
const rejection = (message: string, detail: Args) => ({ code: "conflict", message, detail });

function refusalDetail(error: JournalRefusal): Args {
  return { journalCode: error.journalCode, head: error.head, field: error.field, uncertain: error.uncertain };
}

/** Decode a prepare payload: its request and the fields without the identity. */
function decodePrepare(payload: unknown): { requestId: string; fields: Args } {
  const p: unknown = typeof payload === "string" ? JSON.parse(payload) : null;
  if (!isRecord(p) || IDENTITY.some((k) => typeof p[k] !== "string")) {
    throw rejection("INVALID_REQUEST: missing identity", { journalCode: "INVALID_REQUEST", uncertain: false });
  }
  const fields: Args = { ...p };
  for (const k of IDENTITY) delete fields[k];
  return { requestId: String(p.requestId), fields };
}

/** A restore prepare's (or any prepare's) bound reply for the payload `args` carried. */
export async function boundRestoreReply(args: unknown, reply: unknown): Promise<unknown> {
  const payload = isRecord(args) ? String(args.payload) : "";
  const p: unknown = JSON.parse(payload);
  const requestId = isRecord(p) ? p.requestId : null;
  return { bind: { requestId, digest: await sha256Hex(payload) }, reply };
}

/**
 * Answer a prepare-shaped command over `run`: decode the payload `args`
 * carried, hand `run` its fields without the identity, bind the reply to the
 * request, and turn a fake refusal into the command's rejection (see the header).
 */
export async function answerPrepare(args: unknown, run: (fields: Args) => Promise<unknown>): Promise<unknown> {
  const payload = isRecord(args) ? String(args.payload) : "";
  const { requestId, fields } = decodePrepare(payload);
  const digest = await sha256Hex(payload);
  try {
    return { bind: { requestId, digest }, reply: await run(fields) };
  } catch (error) {
    if (!(error instanceof JournalRefusal)) throw error;
    if (error.journalCode === "JOURNAL_UNAVAILABLE") {
      throw rejection(error.message, { journalCode: "JOURNAL_UNAVAILABLE" });
    }
    const request = { id: requestId, digest, state: "notAdmitted" };
    throw rejection(error.message, { ...refusalDetail(error), uncertain: false, request });
  }
}

const prepare = (args: Args) =>
  answerPrepare(args, async (fields) => {
    // The fake validates the fields it reads; the wire carries them as JSON.
    const prepared = await fake.prepareControlledWrite(fields as unknown as PrepareInput);
    return { ...prepared, certified: isRecord(fields.certificate), fallbackReason: null };
  });

/** Rethrow a fake refusal as the command's rejection. */
async function plain<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof JournalRefusal) throw rejection(error.message, refusalDetail(error));
    throw error;
  }
}

const pairBind = (args: Args) => ({ txn: args.txn, pageIdentity: args.pageIdentity, webviewGeneration: args.webviewGeneration });

async function commit(args: Args): Promise<unknown> {
  const body: unknown = JSON.parse(String(args.payload));
  const { postimage, ...extras } = isRecord(body) ? body : {};
  const hasExtras = Object.keys(extras).length > 0;
  const ack = await plain(() => fake.commitControlledWrite(String(args.txn), String(postimage), hasExtras ? extras : undefined));
  return { bind: pairBind(args), reply: { ...ack, certified: false, fallbackReason: null } };
}

async function abort(args: Args): Promise<unknown> {
  // The reason is whatever the client sent; the fake records it.
  const reason = String(args.reason) as JournalAbortReason;
  const ack = await plain(() => fake.abortControlledWrite(String(args.txn), reason));
  return { bind: pairBind(args), reply: ack };
}

/** Abandons the fake answered: always `fenced`. */
export const abandonSpy = vi.fn((_payload: string) => ({ state: "fenced" }));

/** The commands whose reply echoes the caller's `callId` (`journalIpc.callJournalBound`). */
const CALL_BOUND = new Set([
  "agent_journal_capture",
  "agent_journal_arm_epoch",
  "agent_journal_close_epoch",
  "agent_journal_bind_document",
  "agent_journal_find_document",
  "agent_journal_release_window",
  "agent_journal_discard",
  "agent_journal_uncommitted",
  "agent_journal_checkpoints_forget",
  "agent_journal_checkpoints",
  "agent_journal_history",
  "agent_journal_status",
  "agent_journal_git_export",
  "agent_journal_head",
  "agent_journal_review_decide",
  "agent_journal_concurrent_pair",
  "comment_user_mark_addressed",
  "comment_user_resolve",
  "comment_user_reopen",
  "comment_user_delete",
  "comment_user_list",
  "comment_agent_mark_addressed",
  "comment_agent_list",
]);

type Answerer = (command: string, args: Args) => Promise<unknown>;

/** `respond`'s answer, with a call-bound command's `callId` checked, stripped and echoed. */
async function bindCall(command: string, args: Args, respond: Answerer): Promise<unknown> {
  if (!CALL_BOUND.has(command)) return respond(command, args);
  const { callId, ...rest } = args;
  if (typeof callId !== "string" || !/^[0-9a-f]{32}$/.test(callId)) {
    throw rejection("INVALID_REQUEST: callId must be 32 lowercase hex digits", { journalCode: "INVALID_REQUEST" });
  }
  return { bind: { callId }, reply: await respond(command, rest) };
}

/** The global `invoke` mock, loaded late: a static import would load the Tauri core before a test file's own mock of it. */
async function viaInvoke(command: string, args: Args): Promise<unknown> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<unknown>(command, args);
}

/** Answer one journal command over the fake. */
export function invokeJournal(command: string, args: Args): Promise<unknown> {
  return bindCall(command, args, answer);
}

async function answer(command: string, args: Args): Promise<unknown> {
  switch (command) {
    case "agent_journal_register_page": {
      generation += 1;
      const pageIdentity = args.pageIdentity;
      return { bind: { pageIdentity }, reply: { incarnation: INCARNATION, webviewGeneration: String(generation), pageIdentity } };
    }
    case "agent_journal_prepare":
      return prepare(args);
    case "agent_journal_commit":
      return commit(args);
    case "agent_journal_abort":
      return abort(args);
    case "agent_journal_abandon":
      return abandonSpy(String(args.payload));
    case "agent_journal_capture": {
      const input: unknown = JSON.parse(String(args.payload));
      return plain(() => fake.captureSaveToJournal(input as Parameters<typeof fake.captureSaveToJournal>[0]));
    }
    default:
      return viaInvoke(command, args);
  }
}

/** The module object for `vi.mock("@/services/agentJournal/journalTransport", …)`. */
export function journalTransportModule() {
  return { invokeJournal };
}

/**
 * A transport that answers every command from the global `invoke` mock,
 * only binding the call-bound ones: for a client test that scripts the
 * raw replies of its commands.
 */
export function callBindingTransportModule() {
  return { invokeJournal: (command: string, args: Args) => bindCall(command, args, viaInvoke) };
}
