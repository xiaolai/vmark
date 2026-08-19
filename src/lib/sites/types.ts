/**
 * Purpose: Type contracts for the site plugin system (ADR-S1/S2/S3; wiring plan
 * dev-docs/plans/20260819-browser-wire-and-borrows.md, which supersedes the
 * deleted 20260712 plan these files used to cite).
 *
 * A site plugin dispatches on ORIGIN (mirroring how the format registry dispatches
 * on extension). The manifest is the declarative, validated half; its `origins` are
 * the security boundary — the driver may only reach an origin a plugin declared
 * (R4). Registration is atomic with the plugin's reader (WI-NB4.2), so a
 * registered-but-unreadable site is unrepresentable.
 *
 * The vocabulary is `read`-only: `publish` was removed with `SitePublisher`
 * (WI-DP1.2, "a promise the compiler cannot keep") and its capability token
 * followed in WI-NB4.4 — an unbacked token invited manifests claiming a
 * capability nothing could deliver. `health.ts` went with it: its probe contract
 * (auth + fixture extraction) had no possible honest consumer without
 * credentialed site flows, and neither a listSites surface nor a status panel
 * exists. Re-introduce both together if ADR-S4 is ever revisited.
 */

/** Current agent API version the host exposes to in-page plugin modules. */
export const CURRENT_AGENT_API = 1;

/** The capability vocabulary — the single source for both the type and the
 *  registry's runtime validation, so the two cannot drift apart. Frozen because
 *  `as const` is compile-time only: the validation vocabulary must not be mutable at
 *  runtime (e.g. a `push` before the registry snapshots it into its allowlist Set). */
export const SITE_CAPABILITIES = Object.freeze(["read"] as const);

export type SiteCapability = (typeof SITE_CAPABILITIES)[number];

/**
 * A registered manifest is frozen (the registry commits a deep copy), so the type
 * is `readonly` throughout: a mutation the type permitted would throw at runtime,
 * and `origins` is the security boundary — it must not *look* widenable.
 */
export interface SiteManifest {
  /** Stable id, kebab-case: `/^[a-z0-9-]+$/`. */
  readonly id: string;
  /** i18n key for the display name (never a hardcoded string). */
  readonly nameI18nKey: string;
  /**
   * Origin patterns this plugin claims — each an exact origin (`https://zhihu.com`)
   * or a subdomain wildcard (`https://*.zhihu.com`). Feeds the driver allowlist (R4).
   * Must be non-empty and every entry must be a valid pattern.
   */
  readonly origins: readonly string[];
  /** Which capabilities the plugin provides. Must be non-empty. */
  readonly capabilities: readonly SiteCapability[];
  /** Minimum agent API version required; rejected if > CURRENT_AGENT_API. */
  readonly minAgentApi: number;
}
