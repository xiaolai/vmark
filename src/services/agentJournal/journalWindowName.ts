/**
 * Journal window names — mints the name a tab saves one document under:
 * `<window>/<tab>@<nonce>`, the nonce unique to this run, so a name released
 * in the journal is never minted again and a late capture under it cannot
 * register again. Without a random source no name is minted, and the
 * save that asked for one is not recorded.
 *
 * @coordinates-with services/agentJournal/documentIdentity.ts — keeps one name per tab and document
 * @module services/agentJournal/journalWindowName
 */

import { randomHex } from "./randomHex";

/** The journal's window-name limit, in UTF-8 bytes. */
const WINDOW_NAME_MAX_BYTES = 512;

const RUN = randomHex(4);
let nonce = 0;

/** The longest prefix of `text` (whole code points) within `maxBytes` of UTF-8. */
function fit(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  let bytes = 0;
  let out = "";
  for (const ch of text) {
    bytes += encoder.encode(ch).length;
    if (bytes > maxBytes) break;
    out += ch;
  }
  return out;
}

/** A fresh window name for tab `tabId` of window `windowLabel`, never returned twice in a run; `null` without a random source. */
export function mintJournalWindowName(windowLabel: string, tabId: string): string | null {
  if (RUN === null) return null;
  const suffix = `@${RUN}${(nonce++).toString(36)}`;
  return fit(`${windowLabel}/${tabId}`, WINDOW_NAME_MAX_BYTES - suffix.length) + suffix;
}
