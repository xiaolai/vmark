/**
 * MCP v2 `vmark.browser.workflow_record` handler (WI-NB7.3) — the record surface.
 *
 * `recordOp: "start"` is CONSENT-GATED by the `record` operation (NEVER_GRANTABLE,
 * so a fresh per-call approval every time — recording the user's own actions is
 * never a standing permission). Once consent exists it ARMS the page-world shim via
 * a gated `record` eval and opens a host-owned recording session.
 *
 * `recordOp: "stop"` drains the shim a final time, finalizes the trace through the
 * TRUSTED host-side redactor (`recordingToWorkflow`), and returns value-free workflow
 * `source` the model can save or feed straight to `workflow_run`.
 *
 * The arm is authoritatively gated (a `record` one-shot the Rust driver consumes);
 * re-arm and drain are read-class — the recorder is never a security boundary
 * (redaction is), so continuing an already-consented session needs no re-prompt.
 * The drained buffer IS page data: `parseDrainedEvents` drops page-supplied
 * navigate events and urls (navigation records are host-side only, D2v2) and caps
 * a drain; the session records the entry URL itself so the workflow has an entry
 * point.
 *
 * @coordinates-with lib/browser/workflow/drainedEvents.ts — the drain trust boundary
 * @coordinates-with services/workflow/recorderSession.ts — the host-owned session
 * @coordinates-with lib/browser/agent/recorderShim.ts — the arm/drain scripts
 * @coordinates-with src-tauri browser/authorize.rs — consumes the `record` one-shot
 * @module services/mcpBridge/v2/browserRecord
 */

import { invoke } from "@tauri-apps/api/core";
import { bridgeErrorEnvelope } from "./bridgeError";
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { originForAgent } from "@/lib/browser/url";
import { buildArmScript, buildDisarmScript, buildRecorderDrainScript } from "@/lib/browser/agent/recorderShim";
import { parseDrainedEvents } from "@/lib/browser/workflow/drainedEvents";
import type { RecorderDeps } from "@/services/workflow/recorderSession";
import { browserWarn } from "@/utils/debug";
import { readTabIdArg, resolveBrowserTab, type BrowserTarget } from "./browserHelpers";
import { browserGate } from "./browserAccess";
import { grantPatternFor } from "@/stores/browserApprovalStore.helpers";
import { mintOneShotConfirmed } from "@/services/browser/grantSync";

const RECORD_OP = "record";
const MAX_SITE = 64;

// Lazy-loaded with the rest of the workflow engine — the record path is only
// reached when the AI records a workflow, so it must not weigh the eager bundle.
const recorderService = () => import("@/services/workflow/recorderSession");

/** A site id is a single-line front-matter scalar; keep it bounded and non-empty. */
function normalizeSite(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim().replace(/[\r\n]+/g, " ") : "";
  return s ? s.slice(0, MAX_SITE) : "recording";
}

/** The real host operations for a session: re-arm and drain are read-class evals. */
function makeDeps(): RecorderDeps {
  return {
    rearm: async (tabId, generation) => {
      await invoke("browser_eval", { tabId, script: buildArmScript(), operation: "read", generation });
    },
    disarm: async (tabId, generation) => {
      await invoke("browser_eval", { tabId, script: buildDisarmScript(), operation: "read", generation });
    },
    drainOnce: async (tabId, generation) => {
      const raw = await invoke<string>("browser_eval", {
        tabId,
        script: buildRecorderDrainScript(true),
        operation: "read",
        generation,
      });
      // The trust boundary: page-supplied navigate events and urls are dropped,
      // and a drain is capped (S-03). A cap firing is a page misbehaving — say so.
      const drained = parseDrainedEvents(raw);
      if (drained.oversized) browserWarn("recorder drain refused: payload over the size cap", { tabId });
      else if (drained.truncated) browserWarn("recorder drain truncated to the event cap", { tabId });
      return drained.events;
    },
  };
}

/** Consent-gate on `record`, then arm and open the session. Mirrors the act path. */
/** Tabs whose recording start is in progress: the check-then-arm below crosses
 *  awaits, and two concurrent starts used to both pass the active check. */
const starting = new Set<string>();

async function startRecording(id: string, tab: BrowserTarget, site: string): Promise<void> {
  if (starting.has(tab.tabId)) {
    await respond({ id, success: false, error: "recording-already-active" });
    return;
  }
  starting.add(tab.tabId);
  try {
    await startRecordingReserved(id, tab, site);
  } finally {
    starting.delete(tab.tabId);
  }
}

async function startRecordingReserved(id: string, tab: BrowserTarget, site: string): Promise<void> {
  // Guard BEFORE the approval flow, not merely before arming: a duplicate start
  // used to raise a prompt (or spend an "Allow once") for a recording that was
  // already running and then perform nothing.
  const { isRecording, startRecorderSession } = await recorderService();
  if (isRecording(tab.tabId)) {
    await respond({ id, success: false, error: "recording-already-active" });
    return;
  }
  const approvals = useBrowserApprovalStore.getState();
  const decision = approvals.decide(tab.url, RECORD_OP);
  if (decision === "denied") {
    await respond({ id, success: false, error: `operation '${RECORD_OP}' is not permitted` });
    return;
  }
  if (decision === "needs-approval") {
    const authorized = useBrowserApprovalStore
      .getState()
      .consumeOneShot(tab.url, RECORD_OP, undefined, tab.tabId, undefined, tab.generation);
    if (!authorized) {
      const queued = useBrowserApprovalStore
        .getState()
        .requestApproval(id, tab.url, RECORD_OP, undefined, tab.tabId, tab.generation);
      if (queued === "overloaded" || queued === "rejected") {
        await respond({
          id,
          success: false,
          error: "approval queue is full — resolve or deny pending approvals, then retry",
        });
        return;
      }
      await respond({
        id,
        success: false,
        error: `approval required to record on ${originForAgent(tab.url)}`,
        data: { needsApproval: true, operation: RECORD_OP, url: originForAgent(tab.url), tabId: tab.tabId },
      });
      return;
    }
    // One mint path (audit A-04): the mirror's copy is spent above; wait for the
    // driver to hold its own before arming, or the authoritative `browser_eval`
    // races the push and refuses a recording the user just approved.
    const pattern = grantPatternFor(tab.url);
    const minted =
      pattern !== null &&
      (await mintOneShotConfirmed({
        originPattern: pattern,
        operation: RECORD_OP,
        tabId: tab.tabId,
        generation: tab.generation,
      }));
    if (!minted) {
      await respond({
        id,
        success: false,
        error: "the driver refused the 'record' authorization — the page may have navigated; retry to be prompted again",
      });
      return;
    }
  }

  try {
    await invoke("browser_eval", {
      tabId: tab.tabId,
      script: buildArmScript(),
      operation: RECORD_OP,
      generation: tab.generation,
    });
  } catch (error) {
    // The driver's typed refusal (STALE_COMMAND, EVAL_TIMEOUT, a permission
    // failure) reaches the model as its token and message, not one generic line.
    await respond({ id, success: false, ...bridgeErrorEnvelope(error) });
    return;
  }
  const started = startRecorderSession({
    tabId: tab.tabId,
    site,
    generation: tab.generation,
    startUrl: tab.url,
    deps: makeDeps(),
  });
  if (!started.ok) {
    await respond({ id, success: false, error: started.error });
    return;
  }
  await respond({ id, success: true, data: { status: "recording", tabId: tab.tabId, site } });
}

/** Drain, finalize, and return the recorded workflow source. */
async function stopRecording(id: string, tab: BrowserTarget): Promise<void> {
  const { stopRecorderSession } = await recorderService();
  const result = await stopRecorderSession(tab.tabId);
  if (!result) {
    await respond({ id, success: false, error: "no active recording for this tab" });
    return;
  }
  await respond({
    id,
    success: true,
    data: {
      source: result.source,
      inputs: result.inputs,
      eventCount: result.eventCount,
      capped: result.capped,
    },
  });
}

/** `vmark.browser.workflow_record` — start or stop a workflow recording. */
export async function handleBrowserWorkflowRecord(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    if (!(await browserGate(id))) return;
    const recordOp = args.recordOp;
    if (recordOp !== "start" && recordOp !== "stop") {
      await respond({ id, success: false, error: "workflow_record requires recordOp 'start' or 'stop'" });
      return;
    }
    const tabIdArg = readTabIdArg(args);
    if (tabIdArg === null) {
      await respond({ id, success: false, error: "tabId must be a non-empty string when supplied" });
      return;
    }
    const tab = resolveBrowserTab(tabIdArg);
    if (!tab) {
      await respond({ id, success: false, error: "no active browser tab" });
      return;
    }
    if (tab.automationMode === "human") {
      await respond({ id, success: false, error: "TAB_NOT_AI_OWNED" });
      return;
    }
    if (recordOp === "start") {
      await startRecording(id, tab, normalizeSite(args.site));
      return;
    }
    await stopRecording(id, tab);
  });
}
