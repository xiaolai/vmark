/**
 * Journey: journal-rapid-reloads  (WI-AL2.2g · agent edit journal · page lifetime)
 *
 * Each reload ends one page and starts another; the journal's page
 * generations must keep up. Reloading 5 times in a row, with an agent write
 * after each, catches a stale registration, a generation that does not
 * advance, or an end-of-page that lands on the NEXT page.
 *
 * How: a document window on a fixture file (`e2e/lib/journalWindow.mjs`).
 * Each round: `location.reload()`, wait for the new page to be drivable,
 * install the IPC probe, find the tab, write.
 *
 * Asserts, every round: the write is `durable: true` and the new page sent
 * `agent_journal_register_page` exactly once. After the last round the
 * journal holds one controlled `document.write` per round, and nothing
 * uncommitted for the file.
 */

import {
  openJournalWindow,
  closeJournalWindow,
  reloadWindow,
  installProbe,
  fileTab,
  ipcCounts,
  writeDocument,
  journalOf,
} from "../lib/journalWindow.mjs";

const ROUNDS = 5;

export default {
  name: "journal-rapid-reloads",
  platforms: ["darwin"],
  coverageRequired: true,

  async run(client, ctx) {
    const win = await openJournalWindow(client, ctx);
    try {
      const before = (await journalOf(client, win.filePath)).writes.length;
      for (let round = 1; round <= ROUNDS; round++) {
        await reloadWindow(client, win.label, `(() => { location.reload(); return true; })()`);
        await installProbe(client, win.label);
        const tabId = await fileTab(client, win.label);
        const written = await writeDocument(client, win.label, tabId, `# journal\n\nround ${round}\n`);
        if (written.durable !== true) throw new Error(`round ${round}: the write was not durable: ${JSON.stringify(written)}`);
        const counts = await ipcCounts(client, win.label);
        if (counts.agent_journal_register_page !== 1) {
          throw new Error(`round ${round}: expected one agent_journal_register_page, got ${counts.agent_journal_register_page ?? 0}`);
        }
      }
      const after = await journalOf(client, win.filePath);
      if (after.writes.length - before !== ROUNDS) {
        throw new Error(`expected ${ROUNDS} new journaled writes, got ${after.writes.length - before}`);
      }
      if (after.uncommitted.length !== 0) {
        throw new Error(`expected nothing uncommitted, got ${after.uncommitted.length}`);
      }
      ctx.log(`${ROUNDS} reloads, ${ROUNDS} durable writes`);
    } finally {
      await closeJournalWindow(client, win);
    }
  },
};
