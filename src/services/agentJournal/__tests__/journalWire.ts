// WI-AL2.2g — a scripted journal at the raw `invoke` boundary, for the suites that run the real transport, IPC validation, page registration and request coordinator: per-command handlers, an echoing page registration, and the bound and request-answer shapes the Rust commands send
import { vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

export const INCARNATION = "0123456789abcdef0123456789abcdef";

type Args = Record<string, unknown>;
type Handler = (args: Args) => unknown;

/** Lowercase hex SHA-256 of `text`. */
export async function digestOf(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A registration reply echoing `pageIdentity`. */
export function registered(pageIdentity: unknown, webviewGeneration: string, incarnation = INCARNATION): unknown {
  return { bind: { pageIdentity }, reply: { incarnation, webviewGeneration, pageIdentity } };
}

/** A prepare's bound reply for payload `payload`. */
export async function boundPrepare(payload: string, reply: unknown): Promise<unknown> {
  const p: unknown = JSON.parse(payload);
  const requestId = typeof p === "object" && p !== null && "requestId" in p ? p.requestId : null;
  return { bind: { requestId, digest: await digestOf(payload) }, reply };
}

/** A commit's or abort's bound reply for `args`. */
export function boundPair(args: Args, reply: unknown): unknown {
  return { bind: { txn: args.txn, pageIdentity: args.pageIdentity, webviewGeneration: args.webviewGeneration }, reply };
}

/** A request answer rejection for payload `payload`. */
export async function requestAnswer(
  payload: string,
  journalCode: string,
  uncertain: boolean,
  request: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<unknown> {
  const p: unknown = JSON.parse(payload);
  const id = typeof p === "object" && p !== null && "requestId" in p ? p.requestId : null;
  const detail = { journalCode, ...extra, uncertain, request: { id, digest: await digestOf(payload), ...request } };
  return { code: "conflict", message: `${journalCode}: refused`, detail };
}

/** A prepare reply's fields. */
export function preparedReply(n = 1, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    doc: "path:/a.md",
    txn: `txn-${n}`,
    revision: `rev-${n}`,
    generation: "1",
    baseline: null,
    certified: false,
    fallbackReason: null,
    ...extra,
  };
}

/** Script the raw `invoke`: per-command handlers; registration echoes by default. */
export function scriptWire() {
  const handlers = new Map<string, Handler>();
  const calls: Array<{ command: string; args: Args }> = [];
  const state = { generation: 0n, fixedGeneration: null as string | null };
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command: string, raw?: unknown) => {
    const args: Args = typeof raw === "object" && raw !== null ? { ...raw } : {};
    calls.push({ command, args });
    const handler = handlers.get(command);
    if (handler) return handler(args);
    if (command === "agent_journal_register_page") {
      state.generation += 1n;
      return registered(args.pageIdentity, state.fixedGeneration ?? state.generation.toString());
    }
    return undefined;
  });
  return {
    calls,
    state,
    on(command: string, handler: Handler) {
      handlers.set(command, handler);
    },
    /** Every call's args to `command`, in order. */
    argsOf(command: string): Args[] {
      return calls.filter((c) => c.command === command).map((c) => c.args);
    },
    /** Every prepare payload sent for `command`, decoded. */
    payloadsOf(command = "agent_journal_prepare"): string[] {
      return calls.filter((c) => c.command === command).map((c) => String(c.args.payload));
    },
  };
}
