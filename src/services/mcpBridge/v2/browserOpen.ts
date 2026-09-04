/**
 * MCP v2 `vmark.browser.open` handler — create an AI-owned tab and load a URL.
 *
 * The handler validates the request and reads the AI posture ONCE — it is awaited
 * across, and a setting change mid-flight must not let a profile slip into a shared
 * creation — then runs the stages in `browserOpenFlow` (round 3, #54): profile
 * parsing, profile authorization, the creation transaction. Audit 2026-09-03: one
 * wait budget per request (timing); the driver's AI-tab cap surfaces as its own
 * token (X-01). Split from `browserNavigation.ts` for the file-size gate.
 *
 * @coordinates-with services/mcpBridge/v2/browserOpenFlow — the stages
 * @coordinates-with services/mcpBridge/v2/browserNavigationShared — the shared tail
 * @module services/mcpBridge/v2/browserOpen
 */
import { wrapHandler } from "./wrapHandler";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { aiMode, ensureBrokerStarted, validateNonEmptyString, validateTimeout } from "./browserHelpers";
import { browserGate } from "./browserAccess";
import { readOperationArgs } from "./readOperationArgs";
import { failure } from "./browserNavigationShared";
import { authorizeProfileOpen, createAiTab, readProfile } from "./browserOpenFlow";

export async function handleBrowserOpen(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    if (!(await browserGate(id))) return;
    const wire = readOperationArgs("vmark.browser.open", args);
    if (!validateNonEmptyString(wire.url)) return failure(id, "INVALID_URL");
    const url = wire.url;
    const timeoutMs = validateTimeout(wire.timeoutMs);
    if (timeoutMs === null) return failure(id, "INVALID_TIMEOUT");
    const deadline = Date.now() + timeoutMs;
    const parsedProfile = readProfile(wire.profile);
    if (!parsedProfile.ok) return failure(id, "INVALID_PROFILE");
    const { profile } = parsedProfile;
    await ensureBrokerStarted();
    const mode = aiMode();
    if (profile !== undefined && !(await authorizeProfileOpen(id, url, profile, mode))) return;
    await createAiTab(id, getCurrentWindowLabel(), url, mode, profile, deadline);
  });
}
