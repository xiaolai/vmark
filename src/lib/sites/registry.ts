/**
 * Purpose: Site plugin registry — a module-singleton that dispatches on origin,
 * mirroring `src/lib/formats/registry.ts` (which dispatches on extension).
 * Wiring plan: dev-docs/plans/20260819-browser-wire-and-borrows.md WI-NB4.2 (ADR-S1).
 *
 * Validation is hand-rolled (the repo does not use zod; the format registry sets the
 * precedent). Pattern parsing is delegated to the origin module so wildcard semantics
 * cannot drift, and registered manifests are frozen so a post-registration mutation
 * cannot silently widen the origin-to-plugin security boundary.
 *
 * Registration is ATOMIC with the plugin's reader (WI-NB4.2): `registerSite`
 * takes the pair, so a manifest without a working implementation — "registered
 * but unreadable" — is unrepresentable. `readerForUrl` is the production
 * dispatch point: origin security comes from `dispatchSite` (this registry),
 * URL-level refinement from the reader's own `match`, and the generic reader is
 * the always-present fallback.
 *
 * @coordinates-with lib/browser/origin/originGuard.ts — pattern parsing + matching
 * @coordinates-with lib/browser/reader/siteReader.ts — the SiteReader contract + fallback
 */
import {
  canonicalizeOrigin,
  describeOriginPattern,
  originKey,
  originMatchesPattern,
  type OriginPatternInfo,
} from "@/lib/browser/origin/originGuard";
import { pickReader, type SiteReader } from "@/lib/browser/reader/siteReader";
import {
  CURRENT_AGENT_API,
  SITE_CAPABILITIES,
  type SiteCapability,
  type SiteManifest,
} from "./types";

const ID_PATTERN = /^[a-z0-9-]+$/;
const VALID_CAPABILITIES: ReadonlySet<string> = new Set(SITE_CAPABILITIES);

const sites: SiteManifest[] = [];
const byId = new Map<string, SiteManifest>();
const readers = new Map<string, SiteReader>();
/** Exact (non-wildcard) origin key → owning plugin id, for collision detection + precedence. */
const exactOrigin = new Map<string, string>();
/** Canonical wildcard identity (`*.host:port`) → owning plugin id. Two plugins claiming
 *  the SAME canonical wildcard would make dispatch registration-order-dependent and
 *  silently shadow one of them — reject the collision across sites, not just within one. */
const wildcardOrigin = new Map<string, string>();

/**
 * Read every caller-controlled field EXACTLY ONCE into a plain object.
 *
 * SECURITY: validation and storage must see the same bytes. A manifest is
 * caller-supplied, so a getter (or Proxy) could return a benign origin list to the
 * validator and a different one to the code that commits it — a time-of-check /
 * time-of-use hole in the origin→plugin boundary. Everything downstream of this
 * function reads the snapshot, never `manifest` again.
 */
function snapshotManifest(manifest: SiteManifest): SiteManifest {
  const origins = manifest.origins;
  const capabilities = manifest.capabilities;
  const id = manifest.id;
  if (!Array.isArray(origins)) {
    throw new Error(`Site "${String(id)}" has a non-array origins field.`);
  }
  if (!Array.isArray(capabilities)) {
    throw new Error(`Site "${String(id)}" has a non-array capabilities field.`);
  }
  return {
    id,
    nameI18nKey: manifest.nameI18nKey,
    origins: [...origins],
    capabilities: [...capabilities],
    minAgentApi: manifest.minAgentApi,
  };
}

function validateManifest(manifest: SiteManifest): void {
  if (typeof manifest.id !== "string" || !ID_PATTERN.test(manifest.id)) {
    throw new Error(`Invalid site id "${String(manifest.id)}" (must match ${ID_PATTERN}).`);
  }
  if (byId.has(manifest.id)) {
    throw new Error(`Duplicate site id "${manifest.id}".`);
  }
  if (typeof manifest.nameI18nKey !== "string" || manifest.nameI18nKey.trim() === "") {
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

/** Canonical identity of a declared pattern. The wildcard flag is PART of the
 *  identity: `https://*.a.com` and `https://a.com` are different claims. */
function patternIdentity(info: OriginPatternInfo): string {
  return info.wildcard ? `*.${originKey(info)}` : originKey(info);
}

function validateOrigins(manifest: SiteManifest): void {
  const seen = new Set<string>();
  for (const pattern of manifest.origins) {
    if (typeof pattern !== "string") {
      throw new Error(`Site "${manifest.id}" has a non-string origin pattern.`);
    }
    const info = describeOriginPattern(pattern);
    if (info === null) {
      throw new Error(`Site "${manifest.id}" has an invalid origin pattern "${pattern}".`);
    }
    // Duplicate detection is canonical and covers wildcards too — a repeated
    // pattern is redundant matching work and inconsistent validation, whichever
    // spelling it arrives in.
    const identity = patternIdentity(info);
    if (seen.has(identity)) {
      throw new Error(`Site "${manifest.id}" lists origin pattern "${pattern}" more than once.`);
    }
    seen.add(identity);

    if (info.wildcard) {
      const wildcardOwner = wildcardOrigin.get(identity);
      if (wildcardOwner !== undefined) {
        throw new Error(`Wildcard origin ${identity} already claimed by site "${wildcardOwner}".`);
      }
      continue;
    }
    const owner = exactOrigin.get(originKey(info));
    if (owner !== undefined) {
      throw new Error(`Origin ${originKey(info)} already claimed by site "${owner}".`);
    }
  }
}

/** The paired reader must be a working implementation OF THIS SITE — checked
 *  before anything is committed, so a failed pairing leaves no partial state. */
function validateReader(manifest: SiteManifest, reader: SiteReader): void {
  if (typeof reader !== "object" || reader === null) {
    throw new Error(`Site "${manifest.id}" was registered without a reader.`);
  }
  if (reader.id !== manifest.id) {
    throw new Error(
      `Site "${manifest.id}" was paired with reader "${String(reader.id)}" — the reader's id must match its manifest.`,
    );
  }
  if (typeof reader.match !== "function" || typeof reader.read !== "function") {
    throw new Error(`Site "${manifest.id}"'s reader must implement match(url) and read(html, url).`);
  }
}

/** Register a site plugin — manifest and reader as one atomic pair (WI-NB4.2).
 *  Throws on any validation failure (fail loud), committing nothing. */
export function registerSite(manifest: SiteManifest, reader: SiteReader): void {
  // Snapshot FIRST: what gets validated is exactly what gets committed.
  const snapshot = snapshotManifest(manifest);
  validateManifest(snapshot);
  validateReader(snapshot, reader);

  // Commit a frozen copy so a later mutation of the caller's object cannot change
  // dispatch (the origins list IS the security boundary).
  const frozen: SiteManifest = Object.freeze({
    ...snapshot,
    origins: Object.freeze(snapshot.origins),
    capabilities: Object.freeze(snapshot.capabilities),
  });

  for (const pattern of frozen.origins) {
    const info = describeOriginPattern(pattern)!;
    if (info.wildcard) {
      wildcardOrigin.set(patternIdentity(info), frozen.id);
    } else {
      exactOrigin.set(originKey(info), frozen.id);
    }
  }
  sites.push(frozen);
  byId.set(frozen.id, frozen);
  readers.set(frozen.id, reader);
}

/** The reader paired at registration, by site id. */
export function siteReaderById(id: string): SiteReader | undefined {
  return readers.get(id);
}

/**
 * The reader for `url` — the production dispatch point (WI-NB4.1). Origin
 * security first (`dispatchSite`), then the site reader's own URL refinement,
 * then the generic fallback; null when nothing can read the URL at all.
 */
export function readerForUrl(url: string): SiteReader | null {
  const site = dispatchSite(url);
  const siteReader = site !== null ? readers.get(site.id) : undefined;
  return pickReader(url, siteReader !== undefined ? [siteReader] : []);
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
  readers.clear();
  exactOrigin.clear();
  wildcardOrigin.clear();
}
