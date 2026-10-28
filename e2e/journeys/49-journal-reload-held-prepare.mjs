/**
 * Journey: journal-reload-held-prepare  (WI-AL2.2g · agent edit journal · page lifetime)
 *
 * An agent write is admitted to the journal (prepared), and the page that
 * owns it reloads before its commit lands. The journal must not leave that
 * transaction open forever, nor lose it: the reload ends the old page, and
 * what the page held becomes an UNCOMMITTED entry the user can review. The
 * NEW page must then write normally — it registers itself once and its first
 * write is durable.
 *
 * How: a document window on a fixture file (`e2e/lib/journalWindow.mjs`).
 * The page's IPC probe holds `agent_journal_commit`, so the write is
 * prepared and applied but its commit never reaches Rust. Then
 * `location.reload()` replaces the page. The journal is read from the main
 * window, which is never reloaded.
 *
 * Asserts:
 *   - the held write sent its commit (held) and nothing is uncommitted yet;
 *   - after the reload, exactly one uncommitted entry for the file appears;
 *   - the new page's first write is `durable: true`, and the page sent
 *     `agent_journal_register_page` exactly once.
 *
 * Teardown discards the uncommitted entry, closes the window and removes
 * the fixture.
 */

import {
  openJournalWindow,
  closeJournalWindow,
  holdCommand,
  bridgeOk,
  fireRequest,
  ipcCounts,
  pollUntil,
  reloadWindow,
  installProbe,
  fileTab,
  writeDocument,
  journalOf,
  discardUncommitted,
} from "../lib/journalWindow.mjs";

export default {
  name: "journal-reload-held-prepare",
  platforms: ["darwin"],
  coverageRequired: true,

  async run(client, ctx) {
    const win = await openJournalWindow(client, ctx);
    const created = [];
    try {
      await holdCommand(client, win.label, "agent_journal_commit");
      const read = await bridgeOk(client, win.label, "vmark.document.read", { tabId: win.tabId });
      await fireRequest(client, win.label, "vmark.document.write", {
        tabId: win.tabId,
        content: "# journal\n\nheld write\n",
        expected_revision: read.revision,
      });
      await pollUntil("the held write to send its commit", async () => {
        const counts = await ipcCounts(client, win.label);
        return (counts.agent_journal_commit ?? 0) >= 1;
      });
      const before = await journalOf(client, win.filePath);
      if (before.uncommitted.length !== 0) {
        throw new Error(`expected nothing uncommitted before the reload, got ${before.uncommitted.length}`);
      }

      await reloadWindow(client, win.label, `(() => { location.reload(); return true; })()`);
      let after = before;
      await pollUntil("the held write to become uncommitted", async () => {
        after = await journalOf(client, win.filePath);
        return after.uncommitted.length >= 1;
      });
      created.push(...after.uncommitted.map((u) => u.txn));
      if (after.uncommitted.length !== 1) {
        throw new Error(`expected exactly one uncommitted entry, got ${after.uncommitted.length}`);
      }
      ctx.log(`uncommitted after reload: ${after.uncommitted[0].tool} seq ${after.uncommitted[0].seq}`);

      await installProbe(client, win.label);
      const tabId = await fileTab(client, win.label);
      const written = await writeDocument(client, win.label, tabId, "# journal\n\nafter reload\n");
      if (written.durable !== true) throw new Error(`the new page's write was not durable: ${JSON.stringify(written)}`);
      const counts = await ipcCounts(client, win.label);
      if (counts.agent_journal_register_page !== 1) {
        throw new Error(`expected one agent_journal_register_page, got ${counts.agent_journal_register_page ?? 0}`);
      }
    } finally {
      for (const txn of created) {
        await discardUncommitted(client, win.filePath, txn).catch((e) => ctx.log(String(e)));
      }
      await closeJournalWindow(client, win);
    }
  },
};
