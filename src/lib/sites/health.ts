/**
 * ⚠️ **NOT WIRED — no production caller.** (Branch audit.)
 *
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
  // Zero-trust: a plugin's result is runtime data. Classify by ACTUAL booleans, not
  // truthiness — a malformed `{ authenticated: "false", fixtureExtracted: "false" }`
  // (strings) is truthy and would otherwise be reported `ok`. Anything malformed fails.
  if (typeof probe.fixtureExtracted !== "boolean" || typeof probe.authenticated !== "boolean") {
    return "failed";
  }
  if (!probe.fixtureExtracted) return "failed";
  return probe.authenticated ? "ok" : "degraded";
}

/** Normalize any thrown/rejected value to a message without itself throwing. `String()`
 *  can throw for a null-prototype object or a hostile proxy — which, inside `probeSite`'s
 *  catch, would reject the whole `Promise.all` and discard every site's result. */
function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return "unknown error (unstringifiable value)";
  }
}

/** Default per-probe budget. A probe drives a real browser, so it is allowed to be
 *  slow — but never unbounded: one plugin that never settles would otherwise hang
 *  the aggregate and every other site's result with it. */
const DEFAULT_PROBE_TIMEOUT_MS = 15_000;

/** The platform `setTimeout` clamps anything above this to ~1ms — a value past it (or a
 *  NaN/Infinity/negative one) would produce spurious immediate timeouts. */
const MAX_TIMER_MS = 2_147_483_647;

/** Validate the per-probe budget up front. An invalid `timeoutMs` (NaN, Infinity,
 *  non-positive, or above the platform timer ceiling) collapses to an ~immediate timer
 *  and would report every site as falsely timed-out — fail loud instead. */
function validateTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_MS) {
    throw new RangeError(`timeoutMs must be a finite number in (0, ${MAX_TIMER_MS}] (got ${value}).`);
  }
  return value;
}

/** Reject with a timeout error if `promise` has not settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`health check timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

async function probeSite(
  manifest: SiteManifest,
  check: HealthCheckFn | undefined,
  timeoutMs: number,
): Promise<SiteHealth> {
  const base = { id: manifest.id, capabilities: manifest.capabilities };
  if (check === undefined) {
    return { ...base, status: "unknown" };
  }
  try {
    const probe = await withTimeout(check(), timeoutMs);
    return {
      ...base,
      status: classifyProbe(probe),
      // Only surface a well-formed string detail — a non-string is malformed data.
      ...(typeof probe.detail === "string" ? { detail: probe.detail } : {}),
    };
  } catch (error) {
    // Fail loud but contained: one plugin's thrown (or hung) probe must not sink
    // the batch — it reports `failed` with the reason, like any other failure.
    return {
      ...base,
      status: "failed",
      detail: safeErrorMessage(error),
    };
  }
}

/** Options for a health run. */
export interface SiteHealthOptions {
  /** Per-probe budget in ms; a probe that exceeds it is `failed` (not pending). */
  timeoutMs?: number;
}

/**
 * Run health checks for every registered site and aggregate the results.
 *
 * Checks run concurrently (they are independent browser I/O), but the returned
 * array preserves registry order so the status panel renders a stable list. A
 * site with no entry in `checks` reports `unknown`; a throwing check reports
 * `failed` with its message; a check that outruns its budget reports `failed`
 * with a timeout message rather than blocking the whole aggregate.
 */
export async function runSiteHealth(
  checks: ReadonlyMap<string, HealthCheckFn>,
  options: SiteHealthOptions = {},
): Promise<SiteHealth[]> {
  const timeoutMs = validateTimeout(options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
  return Promise.all(
    listSites().map((manifest) => probeSite(manifest, checks.get(manifest.id), timeoutMs)),
  );
}
