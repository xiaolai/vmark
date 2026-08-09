/**
 * Registry 2 — ProseMirror → mdast converter dispatch (ADR-015 D2, Phase 2).
 *
 * Purpose: replace the 24-arm `switch (node.type.name)` in
 * `proseMirrorToMdast.ts` with a table extensions contribute to, so a node can
 * carry its own serialization and the switch cannot grow back.
 *
 * Dispatch order, per ADR-015 D2:
 *   1. Index by PM node NAME — O(1), and the common case.
 *   2. Within a name, converters declaring a `match` predicate are tried first,
 *      so an extension can claim by attribute (`codeBlock` whose language is the
 *      math sentinel, for example) without owning the whole node type.
 *   3. A converter with no `match` is that name's default, and there may be at
 *      most one.
 *
 * Milkdown scans `Object.values(schema)` and runs every `match` — O(nodes ×
 * schema types). Fine at 24 node types, not at 200 with a third-party ecosystem,
 * so the name index comes first here.
 *
 * Two failure modes are deliberately loud:
 *   - **Unknown node** returns a miss, and the caller decides. The current
 *     switch's `default` warns and returns `null`, which silently DELETES the
 *     node — the same class of silent loss that let `testSchema` drift for
 *     months. Strictness belongs at the call site, which knows whether an
 *     HTML-passthrough fallback is available.
 *   - **Two predicates matching** is an error, never a first-wins race, matching
 *     the claim protocol in `claim.ts`.
 *
 * @coordinates-with lib/extensions/claim.ts — same conflict philosophy
 * @module lib/extensions/pmConverterRegistry
 */

/** A contributed PM → mdast converter. */
export interface PmConverter<TNode, TCtx, TOut> {
  extensionId: string;
  /** ProseMirror node type name, e.g. `codeBlock`. */
  nodeName: string;
  /**
   * Optional attribute-level claim. Converters declaring one are tried before
   * the name's default, so `codeBlock`-with-math-language can be owned by the
   * math extension without taking over all code blocks.
   */
  match?: (node: TNode) => boolean;
  convert: (node: TNode, ctx: TCtx) => TOut;
}

/** Why a lookup failed. */
type LookupFailure =
  | { code: "unknown-node"; nodeName: string; message: string }
  | {
      code: "ambiguous-match";
      nodeName: string;
      extensionIds: readonly string[];
      message: string;
    };

/** Result of resolving one node. */
export type Lookup<TNode, TCtx, TOut> =
  | { ok: true; converter: PmConverter<TNode, TCtx, TOut> }
  | { ok: false; failure: LookupFailure };

/** Raised when registration itself is invalid. */
export class ConverterRegistrationError extends Error {}

/**
 * A name-indexed converter table.
 *
 * Registration is validated eagerly: two defaults for one node name is a
 * programming error and throws at composition time, not at serialize time when
 * a user is editing.
 */
export class PmConverterRegistry<TNode, TCtx, TOut> {
  readonly #defaults = new Map<string, PmConverter<TNode, TCtx, TOut>>();
  readonly #matchers = new Map<string, PmConverter<TNode, TCtx, TOut>[]>();

  /** Register one converter. Throws on a duplicate default. */
  register(converter: PmConverter<TNode, TCtx, TOut>): void {
    if (!converter.nodeName) {
      throw new ConverterRegistrationError(
        `Converter from \`${converter.extensionId}\` has no nodeName.`,
      );
    }

    if (converter.match === undefined) {
      const existing = this.#defaults.get(converter.nodeName);
      if (existing !== undefined) {
        throw new ConverterRegistrationError(
          `Two extensions both claim \`${converter.nodeName}\` as their default ` +
            `converter: \`${existing.extensionId}\` and \`${converter.extensionId}\`. ` +
            "Give one of them a `match` predicate, or resolve the overlap.",
        );
      }
      this.#defaults.set(converter.nodeName, converter);
      return;
    }

    const matchers = this.#matchers.get(converter.nodeName) ?? [];
    matchers.push(converter);
    this.#matchers.set(converter.nodeName, matchers);
  }

  /** Register many, in order. */
  registerAll(converters: Iterable<PmConverter<TNode, TCtx, TOut>>): void {
    for (const converter of converters) this.register(converter);
  }

  /** Node names this registry can convert. */
  knownNodeNames(): readonly string[] {
    return [
      ...new Set([...this.#defaults.keys(), ...this.#matchers.keys()]),
    ].sort();
  }

  /** Find the converter owning `node`. */
  resolve(nodeName: string, node: TNode): Lookup<TNode, TCtx, TOut> {
    const matchers = this.#matchers.get(nodeName) ?? [];
    const claiming = matchers.filter((converter) => {
      try {
        return converter.match?.(node) ?? false;
      } catch {
        // A broken predicate declines rather than failing the document.
        return false;
      }
    });

    if (claiming.length > 1) {
      return {
        ok: false,
        failure: {
          code: "ambiguous-match",
          nodeName,
          extensionIds: claiming.map((c) => c.extensionId),
          message:
            `${claiming.length} converters claim \`${nodeName}\` for this node: ` +
            `${claiming.map((c) => c.extensionId).join(", ")}. Exactly one must ` +
            "match; ordering must not decide ownership.",
        },
      };
    }

    const converter = claiming[0] ?? this.#defaults.get(nodeName);
    if (converter === undefined) {
      return {
        ok: false,
        failure: {
          code: "unknown-node",
          nodeName,
          message:
            `No converter registered for ProseMirror node \`${nodeName}\`. ` +
            "Serializing it would silently drop content.",
        },
      };
    }

    return { ok: true, converter };
  }
}
