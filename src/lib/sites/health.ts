/**
 * Purpose: Site plugin health checks (WI-3.5) — turn a per-plugin auth+fixture
 * probe into a status, and aggregate across the registry for `browser.listSites`
 * and the status panel. Mirrors the MCP sidecar health-check philosophy: a
 * deliberately broken fixture must surface as a hard failure, not a silent pass.
 * Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md WI-3.5 (ADR-S2).
 *
 * This module is pure orchestration: it invokes injected `HealthCheckFn`s (the
 * plugins own the actual auth probe + fixture extraction, which drive the native
 * browser) and classifies their results. Keeping classification here — not inside
 * each plugin — means one authority decides ok/degraded/failed for every site.
 *
 * @coordinates-with lib/sites/registry.ts — listSites() supplies the manifests
 */
import { listSites } from "./registry";
import type { SiteCapability, SiteManifest } from "./types";

/**
 * - `ok`      — authenticated session AND fixture extracted.
 * - `degraded` — fixture extracted but no session (public content still reads).
 * - `failed`  — fixture extraction failed, or the probe threw.
 * - `unknown` — the plugin registered no health check.
 */
export type SiteHealthStatus = "ok" | "degraded" | "failed" | "unknown";

/** Result a plugin's health check reports: an auth probe plus a fixture extraction. */
export interface SiteHealthProbe {
  /** The auth probe found a usable logged-in session. */
  authenticated: boolean;
  /** Fixture extraction produced the expected shape (the core capability works). */
  fixtureExtracted: boolean;
  /** Optional human-facing detail (why it failed, or which session). */
  detail?: string;
}

/** A plugin's health-check thunk: runs the auth probe + fixture extraction. */
export type HealthCheckFn = () => Promise<SiteHealthProbe>;

/** Aggregated per-site health, as surfaced by `browser.listSites` and the status panel. */
export interface SiteHealth {
  id: string;
  capabilities: readonly SiteCapability[];
  status: SiteHealthStatus;
  /** Present only when the probe (or its failure) supplied a message. */
  detail?: string;
}

/**
 * Classify a completed probe. Fixture failure dominates: a plugin that cannot
 * extract its fixture is broken regardless of auth state (the deliberately-broken
 * fixture case). With the fixture working, auth state distinguishes ok vs degraded.
 */
export function classifyProbe(probe: SiteHealthProbe): SiteHealthStatus {
  if (!probe.fixtureExtracted) return "failed";
  return probe.authenticated ? "ok" : "degraded";
}

async function probeSite(
  manifest: SiteManifest,
  check: HealthCheckFn | undefined,
): Promise<SiteHealth> {
  const base = { id: manifest.id, capabilities: manifest.capabilities };
  if (check === undefined) {
    return { ...base, status: "unknown" };
  }
  try {
    const probe = await check();
    return {
      ...base,
      status: classifyProbe(probe),
      ...(probe.detail !== undefined ? { detail: probe.detail } : {}),
    };
  } catch (error) {
    // Fail loud but contained: one plugin's thrown probe must not sink the batch.
    return {
      ...base,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run health checks for every registered site and aggregate the results.
 *
 * Checks run concurrently (they are independent browser I/O), but the returned
 * array preserves registry order so the status panel renders a stable list. A
 * site with no entry in `checks` reports `unknown`; a throwing check reports
 * `failed` with its message.
 */
export async function runSiteHealth(
  checks: ReadonlyMap<string, HealthCheckFn>,
): Promise<SiteHealth[]> {
  return Promise.all(listSites().map((manifest) => probeSite(manifest, checks.get(manifest.id))));
}
