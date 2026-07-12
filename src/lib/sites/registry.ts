/**
 * Purpose: Site plugin registry — a module-singleton that dispatches on origin,
 * mirroring `src/lib/formats/registry.ts` (which dispatches on extension).
 * Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md WI-3.1 (ADR-S1).
 *
 * Validation is hand-rolled (the repo does not use zod; the format registry sets the
 * precedent). Pattern parsing is delegated to the origin module so wildcard semantics
 * cannot drift, and registered manifests are frozen so a post-registration mutation
 * cannot silently widen the origin-to-plugin security boundary.
 *
 * @coordinates-with lib/browser/origin/originGuard.ts — pattern parsing + matching
 */
import {
  canonicalizeOrigin,
  describeOriginPattern,
  originKey,
  originMatchesPattern,
} from "@/lib/browser/origin/originGuard";
import { CURRENT_AGENT_API, type SiteCapability, type SiteManifest } from "./types";

const ID_PATTERN = /^[a-z0-9-]+$/;
const VALID_CAPABILITIES: ReadonlySet<SiteCapability> = new Set(["read", "publish"]);

const sites: SiteManifest[] = [];
const byId = new Map<string, SiteManifest>();
/** Exact (non-wildcard) origin key → owning plugin id, for collision detection + precedence. */
const exactOrigin = new Map<string, string>();

function validateManifest(manifest: SiteManifest): void {
  if (!ID_PATTERN.test(manifest.id)) {
    throw new Error(`Invalid site id "${manifest.id}" (must match ${ID_PATTERN}).`);
  }
  if (byId.has(manifest.id)) {
    throw new Error(`Duplicate site id "${manifest.id}".`);
  }
  if (manifest.nameI18nKey.trim() === "") {
    throw new Error(`Site "${manifest.id}" has an empty nameI18nKey.`);
  }
  if (manifest.origins.length === 0) {
    throw new Error(`Site "${manifest.id}" declares no origins.`);
  }
  validateCapabilities(manifest);
  validateAgentApi(manifest);
  validateOrigins(manifest);
}

function validateCapabilities(manifest: SiteManifest): void {
  if (manifest.capabilities.length === 0) {
    throw new Error(`Site "${manifest.id}" declares no capabilities.`);
  }
  const seen = new Set<SiteCapability>();
  for (const cap of manifest.capabilities) {
    if (!VALID_CAPABILITIES.has(cap)) {
      throw new Error(`Site "${manifest.id}" has an unknown capability "${cap}".`);
    }
    if (seen.has(cap)) {
      throw new Error(`Site "${manifest.id}" lists capability "${cap}" more than once.`);
    }
    seen.add(cap);
  }
}

function validateAgentApi(manifest: SiteManifest): void {
  const api = manifest.minAgentApi;
  if (!Number.isInteger(api) || api < 0) {
    throw new Error(`Site "${manifest.id}" has an invalid minAgentApi (${api}); expected a non-negative integer.`);
  }
  if (api > CURRENT_AGENT_API) {
    throw new Error(`Site "${manifest.id}" needs agent API ${api}, host provides ${CURRENT_AGENT_API}.`);
  }
}

function validateOrigins(manifest: SiteManifest): void {
  const seenExact = new Set<string>();
  for (const pattern of manifest.origins) {
    const info = describeOriginPattern(pattern);
    if (info === null) {
      throw new Error(`Site "${manifest.id}" has an invalid origin pattern "${pattern}".`);
    }
    if (info.wildcard) continue;
    const key = `${info.scheme}://${info.host}:${info.port}`;
    if (seenExact.has(key)) {
      throw new Error(`Site "${manifest.id}" lists origin ${key} more than once.`);
    }
    seenExact.add(key);
    const owner = exactOrigin.get(key);
    if (owner !== undefined) {
      throw new Error(`Origin ${key} already claimed by site "${owner}".`);
    }
  }
}

/** Register a site plugin manifest. Throws on any validation failure (fail loud). */
export function registerSite(manifest: SiteManifest): void {
  validateManifest(manifest);

  // Commit a frozen deep copy so a later mutation of the caller's object cannot
  // change dispatch (the origins list IS the security boundary).
  const frozen: SiteManifest = Object.freeze({
    ...manifest,
    origins: Object.freeze([...manifest.origins]) as string[],
    capabilities: Object.freeze([...manifest.capabilities]) as SiteCapability[],
  });

  for (const pattern of frozen.origins) {
    const info = describeOriginPattern(pattern)!;
    if (!info.wildcard) {
      exactOrigin.set(`${info.scheme}://${info.host}:${info.port}`, frozen.id);
    }
  }
  sites.push(frozen);
  byId.set(frozen.id, frozen);
}

/**
 * Resolve the site plugin owning `url`, or null. Precedence:
 *   1. a plugin claiming the origin EXACTLY wins over any wildcard claim;
 *   2. among matching wildcards, the MOST SPECIFIC (longest base host) wins;
 *   3. ties fall to registration order.
 */
export function dispatchSite(url: string): SiteManifest | null {
  const target = canonicalizeOrigin(url);
  if (target === null) return null;

  const exactOwnerId = exactOrigin.get(originKey(target));
  if (exactOwnerId !== undefined) return byId.get(exactOwnerId) ?? null;

  let best: SiteManifest | null = null;
  let bestSpecificity = -1;
  for (const site of sites) {
    for (const pattern of site.origins) {
      const info = describeOriginPattern(pattern);
      if (info?.wildcard && originMatchesPattern(target, pattern) && info.host.length > bestSpecificity) {
        best = site;
        bestSpecificity = info.host.length;
      }
    }
  }
  return best;
}

export function getSiteById(id: string): SiteManifest | undefined {
  return byId.get(id);
}

export function listSites(): readonly SiteManifest[] {
  // Frozen snapshot — `readonly` is compile-time only; a caller must not be able to
  // splice the internal array and thereby change dispatch at runtime.
  return Object.freeze([...sites]);
}

/** Test-only: clear all registered sites. */
export function __resetSiteRegistry(): void {
  sites.length = 0;
  byId.clear();
  exactOrigin.clear();
}
