/**
 * Journey: mcp-document-write  (Tier-0 · data integrity)
 *
 * An AI client's `document.write` replaces a document AND saves it. If that
 * write goes around the app's save pipeline, the file loses its line endings
 * and its BOM, the tab stays dirty over bytes that are already on disk, and the
 * revision the client was handed is stale before it can use it — each of which
 * shipped once, with every handler-level test green.
 *
 * So this journey takes the path an AI client takes, end to end: the REAL MCP
 * sidecar over stdio (`e2e/lib/vmarkMcp.mjs` — initialize, tool discovery, the
 * sidecar's argument validation and error transformation), VMark's own
 * authenticated bridge, the live handler, the live editor, the real save
 * pipeline; and then reads the file FROM DISK in this Node process.
 *
 * What it asserts, on a CRLF file that starts with a BOM:
 *   - `read` hands back LF text with no BOM, and a revision;
 *   - `write` with that revision reports `saved: true`, `applied: true`,
 *     `durable: true` (recorded in the agent edit journal) and a new revision;
 *   - the journal's own history (`agent_journal_history`, read over IPC, not
 *     from the write's reply) holds exactly ONE controlled `document.write`
 *     revision for the file — new since before the write, and the newest
 *     row — with nothing still queued or left prepared;
 *   - the bytes on disk are the client's text in the file's own convention —
 *     whole-buffer comparison, BOM included (the EOL is derived from the live
 *     `lineEndingsOnSave` preference, as in `line-ending-preservation`);
 *   - the tab is clean and the editor shows the new text;
 *   - a second `read` returns the revision the write returned, not dirty;
 *   - a write carrying the FIRST revision is refused with the structured
 *     code STALE, names the current revision in `structuredContent`, changes
 *     nothing on disk, and leaves the document's whole journal history, queue
 *     and uncommitted entries exactly as they were, with nothing appended to the
 *     journal (its generation unchanged across the refused call).
 *
 * The same flow runs on every PR against the in-memory disk in
 * `src/test/tier0/mcpDocumentWrite.test.tsx`; this is the only place the real
 * sidecar, the real IPC and a real filesystem are in the loop.
 *
 * Safety: identical to the other disk journeys — skip-when-workspace (a
 * Finder-open of an outside file would spawn a window), guard scratch tab,
 * recents restore, temp dir under $HOME removed in teardown. Every write names
 * the fixture's tab id explicitly, so no other tab can be the target. The tab
 * is clean when the journey ends.
 *
 * Waits: every MCP call is a request/response the sidecar bounds itself; the
 * only polls are for the tab bar and editor to reflect the write.
 */

import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { evalJs } from "../lib/bridge.mjs";
import { BOUND_INVOKE_SNIPPET } from "../lib/journalCall.mjs";
import { makeAppTempDir } from "../lib/fixtures.mjs";
import { openFixtureInNewTab } from "../lib/disk.mjs";
import { startVmarkMcp, bridgeReady } from "../lib/vmarkMcp.mjs";
import {
  withTabRestore,
  createScratchTab,
  getTabs,
  getEditorText,
  getPersistedWorkspaceRoot,
  readLocalStorage,
  restoreLocalStorage,
  readLineEndingPreference,
  expectedEol,
  poll,
} from "../lib/vmark.mjs";

const BOM = "﻿";

/** Call the `document` tool and insist it succeeded with a structured payload. */
async function documentOk(mcp, args) {
  const res = await mcp.callTool("document", args);
  if (res.isError) {
    throw new Error(`document ${args.action} was refused: ${res.text.slice(0, 300)}`);
  }
  if (!res.json || typeof res.json !== "object") {
    throw new Error(`document ${args.action} returned no structured payload: ${res.text.slice(0, 300)}`);
  }
  return res.json;
}

/**
 * The journal's own record of `filePath`, read through the app's IPC: every
 * history row, the `document.write` revisions among them, whether a record is
 * still queued, and the uncommitted (prepared, never resolved) entries. A
 * reply's `durable: true` is the handler's claim; this is the evidence.
 */
async function journalState(client, filePath) {
  const payload = JSON.stringify({ docKey: `path:${filePath}` });
  const r = await evalJs(
    client,
    `(async () => {
       try {${BOUND_INVOKE_SNIPPET}
         const h = await boundInvoke("agent_journal_history", { payload: ${JSON.stringify(payload)} });
         const u = await boundInvoke("agent_journal_uncommitted", { payload: ${JSON.stringify(payload)} });
         return JSON.stringify({ ok: true, generation: h.generation, rows: h.rows, degraded: h.degraded, uncommitted: u });
       } catch (e) { return JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) }); }
     })()`,
  );
  const h = JSON.parse(r);
  if (!h.ok) throw new Error(`reading the journal failed: ${h.error}`);
  if (!Array.isArray(h.rows)) throw new Error(`agent_journal_history returned no rows: ${r.slice(0, 300)}`);
  if (!Array.isArray(h.uncommitted)) throw new Error(`agent_journal_uncommitted returned no list: ${r.slice(0, 300)}`);
  // The journal-wide generation (the last appended `seq`), a canonical decimal
  // string on the wire. A prepare that is later aborted appends durable records
  // without adding a history row or leaving an uncommitted entry; only this
  // counter moving shows it.
  if (typeof h.generation !== "string" || !/^(0|[1-9][0-9]*)$/.test(h.generation)) {
    throw new Error(`agent_journal_history returned no decimal generation: ${r.slice(0, 300)}`);
  }
  return {
    generation: h.generation,
    rows: h.rows,
    writes: h.rows.filter((row) => row.kind === "controlled" && row.tool === "document.write"),
    degraded: h.degraded,
    uncommitted: h.uncommitted,
  };
}

/** The row with the highest journal `seq` (a decimal string), or null. */
function newestRow(rows) {
  let newest = null;
  for (const row of rows) {
    if (newest === null || BigInt(row.seq) > BigInt(newest.seq)) newest = row;
  }
  return newest;
}

export default {
  name: "mcp-document-write",
  coverageRequired: true,

  async run(client, ctx) {
    const root = await getPersistedWorkspaceRoot(client, ctx.windowLabel);
    if (root) {
      return { skip: `workspace open (${root}) — Finder-open of an outside file would spawn a new window` };
    }
    if (!(await bridgeReady())) {
      return { skip: "VMark MCP bridge is not advertising a port" };
    }

    const preference = await readLineEndingPreference(client);
    const EOL = expectedEol("crlf", preference);
    ctx.log(`lineEndingsOnSave="${preference}" → a CRLF document must save with ${EOL === "\r\n" ? "CRLF" : "LF"}`);

    const fixture = await makeAppTempDir();
    let mcp = null;
    try {
      mcp = await startVmarkMcp();
      const filePath = join(fixture.dir, `journey-mcp-write-${fixture.stamp}.md`);
      const original = `${BOM}# MCP 写入\r\n\r\noriginal body ${fixture.stamp}\r\n`;
      await writeFile(filePath, original, "utf8");

      /** What the client sends: LF-only, BOM-free, with CJK. */
      const clientText = `# MCP 写入\n\nwritten by the client ${fixture.stamp}\n\n第二段。\n`;
      const expectedOnDisk = BOM + clientText.replace(/\n/g, EOL);

      const recentsBefore = await readLocalStorage(client, "vmark-recent-files");
      try {
        await withTabRestore(client, async ({ before, track }) => {
          const guard = await createScratchTab(client);
          track(guard.id);
          const fileTab = await openFixtureInNewTab(client, { before, track, guardId: guard.id, filePath });
          await poll(
            () => getEditorText(client),
            (t) => typeof t === "string" && t.includes(`original body ${fixture.stamp}`),
            "fixture content loaded into the editor",
          );

          // ── read: the client sees canonical text and a revision ──
          const first = await documentOk(mcp, { action: "read", tabId: fileTab.id });
          if (first.content !== `# MCP 写入\n\noriginal body ${fixture.stamp}\n`) {
            throw new Error(`read did not return LF, BOM-free text: ${JSON.stringify(first.content)}`);
          }
          if (typeof first.revision !== "string" || first.revision.length === 0) {
            throw new Error(`read returned no revision: ${JSON.stringify(first)}`);
          }

          // What the journal held before the write, so the write's row can be
          // told apart from anything recorded when the file was opened.
          const journalBefore = await journalState(client, filePath);
          const revisionsBefore = new Set(journalBefore.rows.map((row) => row.revision));

          // ── write: saved, at a new revision ──
          const written = await documentOk(mcp, {
            action: "write",
            tabId: fileTab.id,
            content: clientText,
            expected_revision: first.revision,
          });
          if (written.saved !== true) {
            throw new Error(`write did not report saved:true: ${JSON.stringify(written)}`);
          }
          if (typeof written.revision !== "string" || written.revision === first.revision) {
            throw new Error(`write did not return a new revision: ${JSON.stringify(written)}`);
          }
          // The write went through the agent edit journal and its record landed.
          if (written.applied !== true || written.durable !== true) {
            throw new Error(`write was not applied durably through the journal: ${JSON.stringify(written)}`);
          }
          // The MCP `revision` is the tab's edit token, not a journal revision id,
          // so the persisted row is bound to THIS write by what changed: the row
          // did not exist before the call, it is the only new controlled
          // document.write row, it is the document's newest row, and nothing is
          // queued or left prepared.
          const journal = await journalState(client, filePath);
          const newWrites = journal.writes.filter((row) => !revisionsBefore.has(row.revision));
          if (journal.writes.length !== 1 || newWrites.length !== 1 || journal.degraded !== false) {
            throw new Error(
              `the journal does not hold exactly one durable document.write revision for the file, recorded by this write ` +
                `(${journal.writes.length} rows, ${newWrites.length} new, degraded=${journal.degraded}): ${JSON.stringify(journal.writes)}`,
            );
          }
          if (newestRow(journal.rows)?.revision !== newWrites[0].revision) {
            throw new Error(
              `the write's journal row is not the document's newest revision: ${JSON.stringify(journal.rows)}`,
            );
          }
          if (journal.uncommitted.length !== 0) {
            throw new Error(`the write left uncommitted journal entries: ${JSON.stringify(journal.uncommitted)}`);
          }

          // ── ground truth: the whole buffer on disk, BOM and every newline ──
          const onDisk = await readFile(filePath, "utf8");
          if (BOM + onDisk === expectedOnDisk) {
            // Named on its own because it has one cause: the document never
            // learned it had a BOM, so the save had nothing to put back.
            throw new Error(
              `the file lost its BOM: every other byte is right, the leading U+FEFF is gone. ` +
                `The save re-adds a BOM only when the document was opened with one (documentStore hasBom), ` +
                `so check what the open path's file read hands the store for a file that starts with EF BB BF.`,
            );
          }
          if (onDisk !== expectedOnDisk) {
            throw new Error(
              `bytes on disk are not the client's text in the file's convention.\n` +
                `  expected (${expectedOnDisk.length}): ${JSON.stringify(expectedOnDisk)}\n` +
                `  on disk  (${onDisk.length}): ${JSON.stringify(onDisk)}`,
            );
          }

          // ── the app agrees: clean tab, new text in the editor ──
          await poll(
            () => getTabs(client),
            (ts) => ts.find((t) => t.id === fileTab.id)?.dirty === false,
            "the written tab to be clean",
          );
          await poll(
            () => getEditorText(client),
            (t) => typeof t === "string" && t.includes(`written by the client ${fixture.stamp}`) && t.includes("第二段。"),
            "the editor to show the written text",
          );

          // ── the revision the write returned is the document's revision ──
          const second = await documentOk(mcp, { action: "read", tabId: fileTab.id });
          if (second.revision !== written.revision) {
            throw new Error(
              `the revision returned by write (${written.revision}) is not the document's revision (${second.revision}) — ` +
                `the client's next write would be refused as stale`,
            );
          }
          if (second.dirty !== false) throw new Error(`read after a saved write reports dirty: ${JSON.stringify(second.dirty)}`);
          if (second.content !== clientText) {
            throw new Error(`read after write does not return the written text: ${JSON.stringify(second.content)}`);
          }

          // ── a write from the superseded snapshot is refused, and changes nothing ──
          // Read immediately before the refused call, so the generation compared
          // below brackets that call alone.
          const journalBeforeStale = await journalState(client, filePath);
          const stale = await mcp.callTool("document", {
            action: "write",
            tabId: fileTab.id,
            content: "overwrite from a stale snapshot\n",
            expected_revision: first.revision,
          });
          // The structured code, not the prose: a text match would accept any
          // message that merely mentions the word.
          if (stale.isError !== true || stale.json?.error !== "STALE") {
            throw new Error(
              `a write with a superseded revision was not refused as STALE: ` +
                `isError=${stale.isError}, structured=${JSON.stringify(stale.json)}, text=${stale.text.slice(0, 300)}`,
            );
          }
          if (stale.json?.current_revision !== written.revision) {
            throw new Error(`the STALE refusal does not carry the current revision: ${JSON.stringify(stale.json)}`);
          }
          const afterStale = await readFile(filePath, "utf8");
          if (afterStale !== expectedOnDisk) {
            throw new Error(`a refused write changed the file: ${JSON.stringify(afterStale)}`);
          }
          const tabAfterStale = (await getTabs(client)).find((t) => t.id === fileTab.id);
          if (tabAfterStale?.dirty !== false) throw new Error("a refused write left the tab dirty");
          // The whole per-document journal is unchanged: same rows (ids, order,
          // parents, actors), nothing queued, nothing left prepared. A count
          // alone would miss a refused write that REPLACED the sole row.
          const journalAfterStale = await journalState(client, filePath);
          // Nothing was appended at all: a prepare-then-abort leaves rows, the
          // queue and the uncommitted list as they were but advances the
          // generation. The generation is journal-wide, so this assumes no other
          // document is written during the call (the journey drives the only
          // write).
          if (journalAfterStale.generation !== journalBeforeStale.generation) {
            throw new Error(
              `a refused write appended to the journal: generation ${journalBeforeStale.generation} → ` +
                `${journalAfterStale.generation}`,
            );
          }
          const recorded = JSON.stringify({ rows: journal.rows, degraded: journal.degraded, uncommitted: journal.uncommitted });
          const afterRefusal = JSON.stringify({
            rows: journalAfterStale.rows,
            degraded: journalAfterStale.degraded,
            uncommitted: journalAfterStale.uncommitted,
          });
          if (afterRefusal !== recorded) {
            throw new Error(
              `a refused write changed the journal.\n  before: ${recorded}\n  after:  ${afterRefusal}`,
            );
          }
          ctx.log(`document.write saved ${onDisk.length} chars with BOM + ${EOL === "\r\n" ? "CRLF" : "LF"}; stale write refused`);
        });
      } finally {
        try {
          await restoreLocalStorage(client, "vmark-recent-files", recentsBefore);
        } catch (err) {
          ctx.log(`warning: could not restore recent-files (${err?.message ?? err})`);
        }
      }
    } finally {
      try {
        if (mcp) await mcp.close();
      } finally {
        await fixture.cleanup();
      }
    }
  },
};
