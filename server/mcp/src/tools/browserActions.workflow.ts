/**
 * `browser` workflow verbs — run, cancel, record (audit row #175, one slice).
 *
 * Purpose: the handlers behind `workflow_run`, `workflow_cancel` and
 * `workflow_record`. Each validates the one argument it cannot do without and
 * forwards the optional ones verbatim; the run itself executes app-side and is
 * observed through `browser_read` action `workflow_status`.
 *
 * @coordinates-with tools/browserActions.ts — the table these slot into
 * @coordinates-with tools/browserReadActions.ts — `workflow_status`, the read half
 * @module tools/browserActions.workflow
 */
import { VMarkMcpServer } from '../server.js';
import type { ToolCallResult } from '../types.js';
import type { BrowserActionContext } from './browserDispatch.js';

/** `workflow_run`: a non-empty workflow source, plus inputs / allowRepeat / resumeRunId as given. */
export async function runWorkflowRun({ server, args, tabId }: BrowserActionContext): Promise<ToolCallResult> {
  if (typeof args.source !== 'string' || args.source.trim() === '') {
    return VMarkMcpServer.errorResult('workflow_run requires a non-empty `source`');
  }
  const data = await server.sendBridgeRequest({
    type: 'vmark.browser.workflow_run',
    ...(tabId === undefined ? {} : { tabId }),
    source: args.source,
    ...(args.inputs !== undefined ? { inputs: args.inputs as Record<string, string> } : {}),
    ...(args.allowRepeat === true ? { allowRepeat: true } : {}),
    ...(typeof args.resumeRunId === 'string' && args.resumeRunId !== '' ? { resumeRunId: args.resumeRunId } : {}),
  });
  return VMarkMcpServer.successJsonResult(data);
}

/** `workflow_cancel`: the run to stop. Never approval-gated. */
export async function runWorkflowCancel({ server, args, tabId }: BrowserActionContext): Promise<ToolCallResult> {
  if (typeof args.runId !== 'string' || args.runId === '') {
    return VMarkMcpServer.errorResult('workflow_cancel requires a `runId`');
  }
  const data = await server.sendBridgeRequest({
    type: 'vmark.browser.workflow_cancel',
    ...(tabId === undefined ? {} : { tabId }),
    runId: args.runId,
  });
  return VMarkMcpServer.successJsonResult(data);
}

/** `workflow_record`: start or stop capturing the user's actions, with an optional site id. */
export async function runWorkflowRecord({ server, args, tabId }: BrowserActionContext): Promise<ToolCallResult> {
  if (args.recordOp !== 'start' && args.recordOp !== 'stop') {
    return VMarkMcpServer.errorResult("workflow_record requires recordOp 'start' or 'stop'");
  }
  const data = await server.sendBridgeRequest({
    type: 'vmark.browser.workflow_record',
    ...(tabId === undefined ? {} : { tabId }),
    recordOp: args.recordOp,
    ...(typeof args.site === 'string' ? { site: args.site } : {}),
  });
  return VMarkMcpServer.successJsonResult(data);
}
