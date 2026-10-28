/**
 * Write addresses — the payload guard of a journaled write: refuse any
 * declared field present with the wrong type, then read the optional
 * `addresses` (the comments it says it addresses) and refuse a malformed set
 * before any journal call.
 *
 * Key decisions:
 *   - A malformed targeting, concurrency or persistence field (`tabId`,
 *     `expected_revision`, `save`, …) is refused, naming it, before a tab is
 *     resolved: read as absent it would turn into a focused-tab write with no
 *     revision guard, saving on.
 *   - Only the shape is checked here: an array of `c<n>` comment ids. The
 *     set rules (at most 64, no repeats, each an unresolved, undeleted comment
 *     of this document) are the journal's, under its writer lock, so they
 *     have one home; its refusal is answered INVALID_ADDRESSES too.
 *   - A malformed set is refused, never dropped: a write that silently lost
 *     its `addresses` would record no link while the agent believes it did.
 *   - An empty array is the same as none, so the prepare carries no field.
 *
 * @coordinates-with journaledEdit.ts — carries the set to the prepare
 * @coordinates-with src-tauri/src/agent_journal/comment/addresses.rs — the set rules
 * @module services/mcpBridge/v2/writeAddresses
 */

import { isCommentId } from "@/services/agentJournal/comments/commentReplies";
import { invalidAddressesError } from "./journalV2Error";
import { structuredError } from "./tabGuard";

/** A write's payload as `readOperationArgsChecked` read it. */
interface CheckedAddresses {
  wire: { addresses?: unknown };
  malformed: ReadonlySet<string>;
}

/**
 * Fields whose malformed value has its own, more specific refusal:
 * INVALID_ADDRESSES here, INVALID_PATCH in `workflowPatch.ts`'s `validatePatches`.
 */
const OWN_REFUSAL: ReadonlySet<string> = new Set(["addresses", "patches"]);

/**
 * The write's `addresses` to spread into its journaled edit (`{}` when none),
 * or `null` after refusing the payload: INTERNAL naming every malformed field
 * that has no refusal of its own, else INVALID_ADDRESSES for a malformed set.
 */
export async function requireWriteArgs(id: string, checked: CheckedAddresses): Promise<{ addresses?: string[] } | null> {
  const malformed = [...checked.malformed].filter((field) => !OWN_REFUSAL.has(field)).sort();
  if (malformed.length > 0) {
    await structuredError(id, { error: "INTERNAL", message: `malformed field(s): ${malformed.join(", ")} — each must have its declared type` });
    return null;
  }
  return requireAddresses(id, checked);
}

async function requireAddresses(id: string, checked: CheckedAddresses): Promise<{ addresses?: string[] } | null> {
  const { addresses } = checked.wire;
  if (addresses === undefined && !checked.malformed.has("addresses")) return {};
  if (!Array.isArray(addresses) || !addresses.every(isCommentId)) {
    await structuredError(id, invalidAddressesError("addresses must be an array of comment ids (c<n>) from comments.list"));
    return null;
  }
  return addresses.length > 0 ? { addresses } : {};
}
