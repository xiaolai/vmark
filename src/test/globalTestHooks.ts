/**
 * Global test lifecycle hooks.
 *
 * Properties every app-tier test gets for free, both of which were
 * previously each file's job to remember — which is the same as saying they
 * were nobody's.
 *
 * Split out of `setup.ts` only because that file sits exactly on the 300-line
 * limit; they belong to the same setup and are imported by it.
 *
 * @coordinates-with src/test/setup.ts — imports this for its side effects
 * @module test/globalTestHooks
 */
import { vi, beforeEach, afterEach } from "vitest";
import { signalMenuCommandsMounted } from "@/services/commands/menuCommandsReady";
import { signalCloseListenersMounted } from "@/services/windowClose/closeListenersReady";
import { resetWindowListeningForTest } from "@/contexts/windowListening";
import { agentJournalFake } from "./agentJournalFake";
import { abandonSpy } from "./agentJournalWireFake";
import { agentJournalEpochFake } from "./agentJournalEpochFake";
import { resetJournalBases } from "@/services/agentJournal/documentIdentity";
// Keep this file's imports light: a module loaded here is loaded before any
// test file's `vi.mock`, so whatever it imports (sonner, stores) can no longer
// be mocked by that file. `saveJournal` reaches sonner through the persistence
// layer, so its per-file state is reset through `documentIdentity` instead.

// Every bridge write goes through the agent edit journal's IPC client; the
// global `invoke` stub answers `undefined`, which the client rightly reads as
// an unavailable journal. The in-memory fake (same reservation, parent CAS,
// baseline and degraded-queue rules as the Rust writer) answers the journal's
// wire (`agentJournalWireFake.ts`), so a test about saving or editing does not
// have to know the journal exists, while the real client, page registration
// and request coordinator still run. Suites that script raw `invoke` opt out
// with `vi.unmock`.
vi.mock("@/services/agentJournal/journalTransport", () => import("./agentJournalWireFake").then((m) => m.journalTransportModule()));
// The epoch calls a tab's provenance session makes, on the same fake journal.
vi.mock("@/services/agentJournal/epochClient", () => import("./agentJournalEpochFake").then((m) => m.epochClientModule()));

// The window-ready handshake waits for the menu listener to mount before it
// tells Rust (and the DOM) that the window is listening — see
// `services/commands/menuCommandsReady.ts`. In the app that signal comes from
// `useCommandBootstrap`, several layers below `WindowProvider`; a test that
// renders the provider with a stand-in child has no such layer, so without
// this it would sit out the whole budget and then log a failure for a mount
// that was never going to happen.
//
// Signalled here rather than per file so the trap cannot be re-sprung by the
// next test that renders a provider. The three suites that are ABOUT the
// handshake call `resetMenuCommandsForTest()` in their own `beforeEach`, which
// runs after this one and therefore wins.
//
// The handshake waits on a second fact for the same reason — the close and
// quit listeners `useWindowClose` registers (`closeListenersReady.ts`) — and a
// provider rendered alone mounts that hook no more than it mounts the menu
// bootstrap, so it gets the same stand-in. The suites about that barrier
// reset it themselves.
beforeEach(() => {
  // `true`: the stand-in is for a mount that SUCCEEDED. The signal carries the
  // outcome since audit #359, and a `false` here would make every provider
  // render log a failed menu mount.
  signalMenuCommandsMounted(true);
  signalCloseListenersMounted(true);
  // A document window ARMS the document surface's gate and its announcement
  // opens it (`windowListening`). Module state outlives a test, so a test whose
  // window never announced would leave the next one's surfaces held back.
  resetWindowListeningForTest();
  agentJournalFake.reset();
  abandonSpy.mockClear();
  agentJournalEpochFake.reset();
  resetJournalBases();
});

// Real timers are the DEFAULT after every test, not a courtesy each file pays
// on its way out. A file that switches to fake timers inside a test and then
// FAILS before its own `vi.useRealTimers()` used to leak them into whatever
// ran next: those tests never advanced a clock nobody was driving, so they sat
// out the full timeout apiece. One real failure became four, and the three
// extra ones pointed at innocent code. No file establishes fake timers in
// `beforeAll` (checked repo-wide), so resetting here cannot take them away
// from anything that meant to keep them.
afterEach(() => {
  vi.useRealTimers();
});
