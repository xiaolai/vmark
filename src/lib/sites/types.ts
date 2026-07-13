/**
 * Purpose: Type contracts for the site plugin system (ADR-S1/S2/S3).
 * Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md
 *
 * A site plugin dispatches on ORIGIN (mirroring how the format registry dispatches
 * on extension). The manifest is the declarative, validated half; its `origins` are
 * the security boundary — the driver may only reach an origin a plugin declared
 * (R4). The reader/publisher orchestrators (Phase 3) are wired separately once the
 * native driver exists; the registry itself is pure and stores only manifests.
 */

/** Current agent API version the host exposes to in-page plugin modules. */
export const CURRENT_AGENT_API = 1;

/** The capability vocabulary — the single source for both the type and the
 *  registry's runtime validation, so the two cannot drift apart. */
export const SITE_CAPABILITIES = ["read", "publish"] as const;

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
