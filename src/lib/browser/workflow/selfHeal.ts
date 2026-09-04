/**
 * Workflow self-healing — propose a locator fix when a step's target moves
 * (WI-4.4 / R8a / WI-NB6.4 / P-3).
 *
 * WIRED: `services/workflow/runExecutor.ts` calls this after a not-found act and
 * re-enters the approval gate with the healed descriptor (P-3): a standing grant
 * for that op+origin covers it; anything else raises a NEW prompt showing the
 * healed role+name, and the old one-shot cannot match it (Rust target binding).
 *
 * Purpose: sites change their markup and a role+name locator that used to match
 * stops matching. Rather than fail hard, this proposes the most similar
 * same-role element in the *current* page snapshot as a candidate fix, with a
 * confidence score. This module only ranks candidates; the approval gate decides.
 *
 * The role must match exactly (a locator never heals across roles — a button is
 * not repaired to a link). How a candidate is SCORED — the edit-distance
 * similarity, the confidence floors, the write-step strictness and the antonym
 * refusal (W-03) — lives in `selfHealScore.ts` (split out in audit r3 #145); this
 * module composes those scores over the snapshot and decides AMBIGUITY.
 *
 * A proposal must be UNAMBIGUOUS, because the executor resolves a role+name locator
 * to the FIRST matching element: a tie between two candidates, or a winning name that
 * occurs twice with that role, means the repaired locator would still not identify one
 * element — so nothing is proposed rather than a coin-flip target (`pickUnambiguous`).
 *
 * @coordinates-with lib/browser/agent/aria.ts — snapshot nodes ARE `AriaNode`s
 * @coordinates-with lib/browser/workflow/selfHealScore.ts — candidate scoring and floors
 * @coordinates-with services/workflow/runExecutor.ts — the caller, post not-found
 * @module lib/browser/workflow/selfHeal
 */
import type { AriaNode } from "../agent/aria";
import { MAX_NAME_LEN, normalizeName, scoreCandidate, type HealPolicy } from "./selfHealScore";

/** A role + accessible-name locator. */
export interface Locator {
  role: string;
  name: string;
}

/** A node from the page ARIA snapshot — derived from `AriaNode`, so the two cannot
 *  drift apart (the snapshot is literally what `ariaSnapshot` produces). */
export type SnapshotNode = Pick<AriaNode, "role" | "name">;

/** A proposed replacement locator with a 0..1 confidence. */
export interface LocatorProposal extends Locator {
  confidence: number;
}

/** A same-role snapshot name that cleared its floor, with its confidence. */
export interface ScoredCandidate {
  name: string;
  confidence: number;
}

/** Validate and default the caller's options into a scoring policy. */
function healPolicy(options: { minConfidence?: number; write?: boolean }): HealPolicy {
  const minConfidence = options.minConfidence ?? 0.6;
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    throw new RangeError(`minConfidence must be a number within [0,1] (got ${minConfidence}).`);
  }
  return { minConfidence, write: options.write ?? false };
}

/**
 * The single unambiguous best among scored candidates, or null: a tie between two
 * DIFFERENT names is a coin flip, and a winning name that occurs more than once
 * would still match several elements. Scoring is a pure function of the name, so
 * every same-role node carrying the winner's name is in `candidates` — counting
 * occurrences here is counting them in the snapshot.
 */
export function pickUnambiguous(candidates: readonly ScoredCandidate[]): ScoredCandidate | null {
  const occurrences = new Map<string, number>();
  let best: ScoredCandidate | null = null;
  let tied = false;
  for (const candidate of candidates) {
    occurrences.set(candidate.name, (occurrences.get(candidate.name) ?? 0) + 1);
    if (!best || candidate.confidence > best.confidence) {
      best = candidate;
      tied = false;
    } else if (candidate.confidence === best.confidence && candidate.name !== best.name) {
      tied = true; // two DIFFERENT names score the same — pick neither
    }
  }
  if (!best || tied) return null;
  if ((occurrences.get(best.name) ?? 0) > 1) return null; // the locator would match several elements
  return best;
}

/**
 * Propose the best same-role replacement for a `failed` locator from the current
 * `snapshot`, or null when nothing clears its floor — `minConfidence` (default 0.6)
 * for a candidate that starts with the failed name (a WRITE holds 0.85 there too),
 * 0.85 otherwise — when the only candidates are prefixed (antonym) forms, or when
 * the best candidate is ambiguous. Never heals across roles.
 */
export function proposeLocatorFix(
  failed: Locator,
  snapshot: readonly SnapshotNode[],
  options: { minConfidence?: number; write?: boolean } = {},
): LocatorProposal | null {
  const policy = healPolicy(options);
  const failedName = normalizeName(failed.name);
  if (failedName.length > MAX_NAME_LEN) return null;

  const scored: ScoredCandidate[] = [];
  for (const node of snapshot) {
    if (node.role !== failed.role) continue;
    const confidence = scoreCandidate(failedName, normalizeName(node.name), policy);
    if (confidence !== null) scored.push({ name: node.name, confidence });
  }
  const best = pickUnambiguous(scored);
  return best ? { role: failed.role, name: best.name, confidence: best.confidence } : null;
}
