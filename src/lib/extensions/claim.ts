/**
 * Claim protocol — ADR-015 D2b, WI-1.3.
 *
 * Purpose: decide which extension owns an ambiguous mdast node, deterministically
 * and visibly, instead of by `if`-order accident.
 *
 * The problem it replaces: a paragraph containing one image may become
 * `block_image`, `block_video`, `block_audio`, or stay a paragraph
 * (`mdastMediaConverters.ts:38`); an `html` node may become video, audio,
 * `video_embed`, `html_block` or `html_inline` (`:72`); a `blockquote` may be an
 * alert; a `codeBlock` may be math via the `MATH_BLOCK_LANGUAGE` sentinel. Today
 * the winner is whichever branch is written first.
 *
 * Why not "first matching predicate wins": that would promote the current
 * accident to a contract, and make ownership depend on registration order —
 * exactly the coupling Phase 3 is trying to remove. Codex called deferring this
 * design a BLOCKER, because the "mechanical" tier of Phase 2 would otherwise
 * bake in an implicit protocol before the explicit one existed.
 *
 * Key decisions:
 *   - Claims are STRENGTH-RANKED, not ordered. `exact` (explicit syntax, tag or
 *     provider) beats `semantic` (inference, e.g. a file extension) beats
 *     `fallback` (ordinary preservation).
 *   - Two claims at the winning strength are an ERROR, not a tie-break. If two
 *     extensions both believe they exactly own a node, one of them is wrong, and
 *     silently picking either hides a real bug.
 *   - `fallback` is a contributed claim, never a hidden `else` in the dispatcher.
 *     Residual html/paragraph preservation is an extension like any other.
 *   - Every bid is recorded, win or lose, so `why did my node become X` is
 *     answerable without a debugger.
 *   - A throwing recognizer declines rather than taking down the document. A
 *     third-party extension must not be able to make a file unopenable.
 *
 * @coordinates-with lib/extensions/types.ts — extension identity
 * @module lib/extensions/claim
 */

/** How strongly an extension asserts ownership. Ranked, highest first. */
export type ClaimStrength = "exact" | "semantic" | "fallback";

const STRENGTH_ORDER: readonly ClaimStrength[] = ["exact", "semantic", "fallback"];

/** A recognizer result is a usable claim only if it declares a known strength. */
function isValidClaim<TOut>(value: unknown): value is Claim<TOut> {
  return (
    typeof value === "object" &&
    value !== null &&
    STRENGTH_ORDER.includes((value as { strength?: ClaimStrength }).strength as ClaimStrength)
  );
}

/** An assertion of ownership over one node. */
export interface Claim<TOut> {
  strength: ClaimStrength;
  /** What the node becomes if this claim wins. */
  value: TOut;
  /** Human-readable justification, surfaced in diagnostics. */
  reason: string;
}

/** An extension's offer to own nodes of one mdast type. */
export interface Recognizer<TIn, TOut> {
  extensionId: string;
  /** The mdast node type this recognizer is indexed under. */
  nodeType: string;
  /** Return `null` to decline. */
  recognize: (node: TIn) => Claim<TOut> | null;
}

/** A recorded bid. */
export interface Bid<TOut> {
  extensionId: string;
  claim: Claim<TOut>;
}

/** Two or more extensions claimed the same node at the same strength. */
export interface ClaimConflict {
  message: string;
  nodeType: string;
  strength: ClaimStrength;
  extensionIds: readonly string[];
}

/** A recognizer that threw. */
export interface RecognizerFailure {
  extensionId: string;
  nodeType: string;
  error: string;
}

/** Outcome of resolving one node. */
export interface ClaimResolution<TOut> {
  winner: Bid<TOut> | null;
  /** Every claim offered, in recognizer order — the trace API. */
  bids: readonly Bid<TOut>[];
  error: ClaimConflict | null;
  failures: readonly RecognizerFailure[];
}

function rank(strength: ClaimStrength): number {
  const index = STRENGTH_ORDER.indexOf(strength);
  return index === -1 ? STRENGTH_ORDER.length : index;
}

/**
 * Resolve which extension owns `node`.
 *
 * Recognizers whose `nodeType` does not match are skipped, so callers may pass
 * the whole registry rather than pre-filtering.
 */
export function resolveClaim<TIn, TOut>(
  recognizers: readonly Recognizer<TIn, TOut>[],
  node: TIn,
  nodeType: string,
): ClaimResolution<TOut> {
  const bids: Bid<TOut>[] = [];
  const failures: RecognizerFailure[] = [];

  for (const recognizer of recognizers) {
    if (recognizer.nodeType !== nodeType) continue;
    let claim: Claim<TOut> | null;
    try {
      claim = recognizer.recognize(node);
    } catch (error) {
      failures.push({
        extensionId: recognizer.extensionId,
        nodeType,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (claim === null) continue;
    // A declining recognizer returns null; anything else must be a well-formed
    // claim. `undefined` or an unknown strength is a malformed recognizer, not a
    // winner — record it as a failure so it cannot crash the reducer below or be
    // selected by ranking past the end of STRENGTH_ORDER.
    if (!isValidClaim<TOut>(claim)) {
      failures.push({
        extensionId: recognizer.extensionId,
        nodeType,
        error: `recognizer returned a malformed claim: ${String(
          (claim as { strength?: unknown } | undefined)?.strength,
        )}`,
      });
      continue;
    }
    bids.push({ extensionId: recognizer.extensionId, claim });
  }

  if (bids.length === 0) {
    return { winner: null, bids, error: null, failures };
  }

  const best = bids.reduce(
    (lowest, bid) => Math.min(lowest, rank(bid.claim.strength)),
    STRENGTH_ORDER.length,
  );
  const contenders = bids.filter((bid) => rank(bid.claim.strength) === best);

  if (contenders.length > 1) {
    const strength = contenders[0].claim.strength;
    const detail = contenders
      .map((bid) => `${bid.extensionId} (${bid.claim.reason})`)
      .join(", ");
    return {
      winner: null,
      bids,
      failures,
      error: {
        message:
          `Ambiguous ownership of \`${nodeType}\`: ${contenders.length} extensions ` +
          `claimed it at strength \`${strength}\` — ${detail}. Exactly one must ` +
          "claim at the winning strength; ordering must not decide ownership.",
        nodeType,
        strength,
        extensionIds: contenders.map((bid) => bid.extensionId),
      },
    };
  }

  return { winner: contenders[0], bids, error: null, failures };
}
