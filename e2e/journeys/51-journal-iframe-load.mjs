/**
 * Journey: journal-iframe-load  (WI-AL2.2g · agent edit journal · page lifetime)
 *
 * A frame loading inside the page fires its own load and navigation events,
 * but the top-level document — the one the journal registered — is still
 * there. If a frame's load were taken for the page's, the registration
 * would be ended under a live page.
 *
 * How: a document window on a fixture file (`e2e/lib/journalWindow.mjs`).
 * One write registers the page. With the IPC probe counting afresh, the
 * journey appends a `srcdoc` iframe made with `createElement("iframe")`,
 * waits for its load, and writes again.
 *
 * Asserts: the write after the frame load is `durable: true`, and the page
 * sent no `agent_journal_register_page` for it while its one
 * prepare and one commit went to the journal. The frame is removed before
 * teardown.
 */

import {
  openJournalWindow,
  closeJournalWindow,
  inWindow,
  installProbe,
  ipcCounts,
  pollUntil,
  writeDocument,
} from "../lib/journalWindow.mjs";

export default {
  name: "journal-iframe-load",
  platforms: ["darwin"],
  coverageRequired: true,

  async run(client, ctx) {
    const win = await openJournalWindow(client, ctx);
    try {
      const first = await writeDocument(client, win.label, win.tabId, "# journal\n\nregistered\n");
      if (first.durable !== true) throw new Error(`the first write was not durable: ${JSON.stringify(first)}`);

      await inWindow(client, win.label, `(() => { delete window.__vmarkE2E; return true; })()`, 5000);
      await installProbe(client, win.label);
      await inWindow(
        client,
        win.label,
        `(() => {
           const frame = document.createElement("iframe");
           frame.id = "e2e-journal-frame";
           frame.style.display = "none";
           frame.addEventListener("load", () => { frame.dataset.loaded = "1"; });
           frame.srcdoc = "<!doctype html><p>frame</p>";
           document.body.appendChild(frame);
           return true;
         })()`,
        5000,
      );
      await pollUntil("the iframe to load", async () =>
        (await inWindow(client, win.label, `document.getElementById("e2e-journal-frame")?.dataset.loaded === "1"`, 5000)) === true,
      );

      const second = await writeDocument(client, win.label, win.tabId, "# journal\n\nafter frame\n");
      if (second.durable !== true) throw new Error(`the write after the frame load was not durable: ${JSON.stringify(second)}`);
      const counts = await ipcCounts(client, win.label);
      if ((counts.agent_journal_register_page ?? 0) !== 0) {
        throw new Error(`the page re-registered after an iframe load (${counts.agent_journal_register_page})`);
      }
      // The write went through the journal from THIS page: without this, a zero
      // registration count could mean the write never reached the journal.
      if (counts.agent_journal_prepare !== 1 || counts.agent_journal_commit !== 1) {
        throw new Error(`expected one prepare and one commit after the frame load, got ${counts.agent_journal_prepare ?? 0} and ${counts.agent_journal_commit ?? 0}`);
      }
      ctx.log(`after the frame load: prepare ${counts.agent_journal_prepare}, commit ${counts.agent_journal_commit}, register_page 0`);
      await inWindow(client, win.label, `(() => { document.getElementById("e2e-journal-frame")?.remove(); return true; })()`, 5000);
    } finally {
      await closeJournalWindow(client, win);
    }
  },
};
