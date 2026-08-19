/**
 * Gate probe (WI-NB2.2) — one best-effort signals eval after a loaded
 * navigation, classified into an advisory `gate` verdict for the result.
 *
 * Purpose: the navigation handlers attach `data.gate {kind, hint}` when the
 * landed page reads as a login wall / consent interstitial / challenge /
 * rate-limit, so the model learns it is NOT looking at the content it asked
 * for — at the moment it reads the navigation result, which is where NeoBrowser
 * surfaced it and where it demonstrably changes model behavior.
 *
 * Contract: NEVER throws and NEVER degrades a navigation result — a rejected
 * eval, a non-JSON result, or an unexpected shape is simply "no gate". The eval
 * is read-class (grant-free on AI tabs), same authorization as any snapshot.
 *
 * @coordinates-with lib/browser/agent/gateScript.ts — the signals script
 * @coordinates-with lib/browser/gates.ts — the classifier
 * @coordinates-with services/mcpBridge/v2/browserNavigation.ts — the caller
 * @module services/mcpBridge/v2/browserGateProbe
 */

import { invoke } from "@tauri-apps/api/core";
import { buildGateSignalsScript } from "@/lib/browser/agent/gateScript";
import { classifyGate, type GateSignals, type GateVerdict } from "@/lib/browser/gates";

function isSignals(v: unknown): v is GateSignals {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.url === "string" &&
    typeof s.title === "string" &&
    typeof s.textHead === "string" &&
    typeof s.challengeWidget === "boolean" &&
    typeof s.passwordField === "boolean"
  );
}

/** Collect and classify one gate-signals snapshot; null on any failure. */
export async function probeGate(tabId: string, generation: number): Promise<GateVerdict | null> {
  try {
    const raw = await invoke<string>("browser_eval", {
      tabId,
      script: buildGateSignalsScript(),
      operation: "read",
      generation,
    });
    if (typeof raw !== "string") return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSignals(parsed)) return null;
    return classifyGate(parsed);
  } catch {
    return null;
  }
}
