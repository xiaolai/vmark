/**
 * Page registration — this page's identity with the agent edit journal:
 * the random identity it registers under its webview's label, the pair
 * (`pageIdentity`, `webviewGeneration`) every request and commit names,
 * and the writer's incarnation.
 *
 * Key decisions:
 *   - The identity (16 random bytes, 32 hex) is minted when the module
 *     loads, inside `try`: a page without a working random source keeps
 *     booting, and every journaled write then refuses `JOURNAL_UNAVAILABLE`
 *     without one journal call.
 *   - Registration is lazy: nothing is invoked and no timer is set until
 *     the first write asks for the page, and the register call runs inside
 *     that write's attempt deadline. One register is shared by concurrent
 *     writers.
 *   - The reply's bind and echo must name the identity sent, with a 32-hex
 *     incarnation and a decimal generation kept as an opaque string; any
 *     other reply is a transport failure and nothing is cached. A register
 *     that times out or fails keeps the identity, so the next write retries
 *     it unchanged.
 *   - A stale answer naming the current pair ends the registration: the
 *     page waits until every write holding the pair has finished (a drain),
 *     then registers a fresh identity with `replaces` = that pair, always.
 *   - `pagehide` bumps the page's lifetime, which a write in flight
 *     re-checks before it applies. A page that is not kept (non-persisted)
 *     never registers again; one kept in the back-forward cache registers a
 *     fresh identity replacing its old pair on its next write — including a
 *     pair whose registration answered only after the `pagehide`, which the
 *     page refuses to use but must not leave registered.
 *
 * @coordinates-with src-tauri/src/agent_journal/commands.rs — `agent_journal_register_page`
 * @coordinates-with services/agentJournal/journalRequest.ts — acquires the page per request
 * @module services/agentJournal/pageRegistration
 */

import { callJournal, isDecimal, isObject, malformed, parseBound } from "./journalIpc";
import { JOURNAL_DEADLINE_MS, withJournalDeadline } from "./journalDeadline";
import { JournalRefusal } from "./journalRefusal";
import { randomHex } from "./randomHex";
import { journalWarn } from "@/utils/debug";

/** The pair a commit or abort names. */
export interface PagePair {
  pageIdentity: string;
  webviewGeneration: string;
}

/** A live registration. */
export interface RegisteredPage extends PagePair {
  incarnation: string;
}

const COMMAND = "agent_journal_register_page";
const HEX32 = /^[0-9a-f]{32}$/;
const isHex32 = (v: unknown): v is string => typeof v === "string" && HEX32.test(v);

/** 16 random bytes as 32 lowercase hex, or `null` when no random source works. */
function mintIdentity(): string | null {
  const identity = randomHex(16);
  if (identity === null) journalWarn("the page identity could not be minted; agent edits are not journaled in this page");
  return identity;
}

interface State {
  /** `null`: minting failed; the journal is unavailable to this page. */
  identity: string | null;
  closed: boolean;
  registered: RegisteredPage | null;
  /** The pair the next registration replaces. */
  replaces: PagePair | null;
  lifetime: number;
  holders: number;
  registering: Promise<RegisteredPage> | null;
  drained: Array<() => void>;
}

function freshState(): State {
  return {
    identity: mintIdentity(),
    closed: false,
    registered: null,
    replaces: null,
    lifetime: 0,
    holders: 0,
    registering: null,
    drained: [],
  };
}

let state = freshState();

const unavailable = (why: string) => new JournalRefusal("JOURNAL_UNAVAILABLE", `agent edits are not journaled in this page: ${why}`);

/** Validate a registration reply for `identity`. Throws `malformed`. */
function parseRegistration(r: unknown, identity: string): RegisteredPage {
  const reply = parseBound(COMMAND, r, { pageIdentity: identity });
  if (!isObject(reply) || reply.pageIdentity !== identity || !isHex32(reply.incarnation) || !isDecimal(reply.webviewGeneration)) {
    throw malformed(COMMAND);
  }
  return { incarnation: reply.incarnation, webviewGeneration: reply.webviewGeneration, pageIdentity: identity };
}

/** Wait until no write holds the current pair. */
function drain(): Promise<void> {
  if (state.holders === 0) return Promise.resolve();
  return new Promise((resolve) => state.drained.push(resolve));
}

/** One shared register of the current identity, after the drain. */
function register(identity: string): Promise<RegisteredPage> {
  const at = state;
  const lifetime = at.lifetime;
  const replaces = at.replaces;
  const run = withJournalDeadline("the page registration", async () => {
    await drain();
    const args = replaces ? { pageIdentity: identity, replaces } : { pageIdentity: identity };
    return parseRegistration(await callJournal(COMMAND, args), identity);
  }, JOURNAL_DEADLINE_MS);
  const shared = run.then(
    (page) => {
      if (state !== at || at.identity !== identity || at.lifetime !== lifetime) {
        // The journal holds this pair now: the next registration replaces it.
        if (state === at) at.replaces = { pageIdentity: page.pageIdentity, webviewGeneration: page.webviewGeneration };
        throw unavailable("the page changed while it registered");
      }
      at.registered = page;
      at.replaces = null;
      return page;
    },
  );
  const clear = () => {
    if (at.registering === shared) at.registering = null;
  };
  shared.then(clear, clear);
  return shared;
}

/**
 * The live registration, registering first when there is none. While
 * `stillWanted()` holds when it is answered, the caller holds the pair and
 * must `releasePage()` once its write has finished.
 */
export async function acquirePage(stillWanted: () => boolean): Promise<RegisteredPage> {
  const at = state;
  if (at.identity === null) throw unavailable("no page identity could be minted");
  if (at.closed) throw unavailable("the page is unloading");
  let page = at.registered;
  if (page === null) {
    at.registering ??= register(at.identity);
    page = await at.registering;
  }
  if (state === at && stillWanted()) at.holders += 1;
  return page;
}

/** A write that acquired the page has finished with its pair. */
export function releasePage(): void {
  if (state.holders === 0) return;
  state.holders -= 1;
  if (state.holders > 0) return;
  for (const wake of state.drained.splice(0)) wake();
}

/** A journal answer said `pair` is stale: when it is the current one, register afresh after the drain. */
export function noteStalePage(pair: PagePair): void {
  const current = state.registered;
  if (!current || current.pageIdentity !== pair.pageIdentity || current.webviewGeneration !== pair.webviewGeneration) return;
  state.replaces = { pageIdentity: current.pageIdentity, webviewGeneration: current.webviewGeneration };
  state.registered = null;
  state.identity = mintIdentity();
}

/** Bumped on every `pagehide`; a write re-checks it before it applies. */
export function pageLifetime(): number {
  return state.lifetime;
}

function onPageHide(event: Event): void {
  state.lifetime += 1;
  const current = state.registered;
  if (current) state.replaces = { pageIdentity: current.pageIdentity, webviewGeneration: current.webviewGeneration };
  state.registered = null;
  const persisted = "persisted" in event && event.persisted === true;
  if (!persisted) state.closed = true;
  else state.identity = mintIdentity();
}

if (typeof window !== "undefined") window.addEventListener("pagehide", onPageHide);

/** Tests: forget everything and mint a new identity. */
export function resetPageRegistration(): void {
  for (const wake of state.drained.splice(0)) wake();
  state = freshState();
}
