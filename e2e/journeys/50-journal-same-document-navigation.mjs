/**
 * Journey: journal-same-document-navigation  (WI-AL2.2g · agent edit journal · page lifetime)
 *
 * The journal ends what a page owned when the page goes away. A hash change
 * or a `history.pushState` is NOT the page going away: the document, its
 * scripts and its journal registration all survive. If either were mistaken
 * for a new page, the next agent write would re-register (or be refused as
 * coming from a dead page) and the old page's open work would be ended.
 *
 * How: a document window on a fixture file (`e2e/lib/journalWindow.mjs`).
 * One write registers the page. With the IPC probe counting afresh, the
 * journey sets `location.hash = …`, calls `history.pushState(…)`, and
 * writes again.
 *
 * Asserts: the write after both navigations is `durable: true`, and the page
 * sent no `agent_journal_register_page` for it while its one
 * prepare and one commit went to the journal (the registration stayed
 * live). The URL is put back with `history.replaceState` before teardown.
 */

import {
  openJournalWindow,
  closeJournalWindow,
  inWindow,
  installProbe,
  ipcCounts,
  writeDocument,
} from "../lib/journalWindow.mjs";

export default {
  name: "journal-same-document-navigation",
  platforms: ["darwin"],
  coverageRequired: true,

  async run(client, ctx) {
    const win = await openJournalWindow(client, ctx);
    try {
      const first = await writeDocument(client, win.label, win.tabId, "# journal\n\nregistered\n");
      if (first.durable !== true) throw new Error(`the first write was not durable: ${JSON.stringify(first)}`);

      // A fresh counter: everything from here on is the navigated page's.
      await inWindow(client, win.label, `(() => { window.__vmarkE2EUrl = location.href; delete window.__vmarkE2E; return true; })()`, 5000);
      await installProbe(client, win.label);
      const moved = await inWindow(
        client,
        win.label,
        `(() => {
           location.hash = "e2e-journal-hash";
           history.pushState({ e2e: true }, "", location.pathname + location.search + "#e2e-journal-push");
           return location.hash;
         })()`,
        5000,
      );
      if (moved !== "#e2e-journal-push") throw new Error(`the navigation did not land: ${JSON.stringify(moved)}`);

      const second = await writeDocument(client, win.label, win.tabId, "# journal\n\nafter navigation\n");
      if (second.durable !== true) throw new Error(`the write after navigation was not durable: ${JSON.stringify(second)}`);
      const counts = await ipcCounts(client, win.label);
      if ((counts.agent_journal_register_page ?? 0) !== 0) {
        throw new Error(`the page re-registered after a same-document navigation (${counts.agent_journal_register_page})`);
      }
      // The write went through the journal from THIS page: without this, a zero
      // registration count could mean the write never reached the journal.
      if (counts.agent_journal_prepare !== 1 || counts.agent_journal_commit !== 1) {
        throw new Error(`expected one prepare and one commit after navigation, got ${counts.agent_journal_prepare ?? 0} and ${counts.agent_journal_commit ?? 0}`);
      }
      ctx.log(`after navigation: prepare ${counts.agent_journal_prepare}, commit ${counts.agent_journal_commit}, register_page 0`);
      await inWindow(client, win.label, `(() => { history.replaceState(null, "", window.__vmarkE2EUrl); return true; })()`, 5000);
    } finally {
      await closeJournalWindow(client, win);
    }
  },
};
