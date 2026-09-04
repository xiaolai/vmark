/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source of truth: server/mcp/src/bridge/operationSchemas.ts
 * Regenerate with: pnpm gen:mcp-contracts
 *
 * A hand-edit here fails `pnpm lint:mcp-contracts` (WI-15).
 */

/** What an operation does with a field its contract does not declare. */
export type UnknownFieldPosture = "reject" | "strip-and-log";

/** Runtime shape family of a declared field. */
export type BridgeFieldKind = "string" | "boolean" | "number" | "array" | "object" | "unknown";

/** One declared field of one operation payload. */
export interface BridgeFieldDescriptor {
  readonly name: string;
  readonly optional: boolean;
  readonly kind: BridgeFieldKind;
}

/** Declared fields per operation, sorted by name. */
export const BRIDGE_OPERATION_FIELDS = {
  "vmark.browser.act": [
    { name: "dy", optional: true, kind: "number" },
    { name: "key", optional: true, kind: "string" },
    { name: "modifiers", optional: true, kind: "object" },
    { name: "name", optional: true, kind: "string" },
    { name: "operation", optional: false, kind: "string" },
    { name: "ref", optional: true, kind: "string" },
    { name: "role", optional: true, kind: "string" },
    { name: "tabId", optional: true, kind: "string" },
    { name: "text", optional: true, kind: "string" },
  ],
  "vmark.browser.close": [
    { name: "tabId", optional: false, kind: "string" },
  ],
  "vmark.browser.console": [
    { name: "clear", optional: true, kind: "boolean" },
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.browser.execute_js": [
    { name: "script", optional: false, kind: "string" },
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.browser.extract": [
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.browser.navigate": [
    { name: "tabId", optional: true, kind: "string" },
    { name: "timeoutMs", optional: true, kind: "number" },
    { name: "url", optional: false, kind: "string" },
  ],
  "vmark.browser.open": [
    { name: "profile", optional: true, kind: "string" },
    { name: "timeoutMs", optional: true, kind: "number" },
    { name: "url", optional: false, kind: "string" },
  ],
  "vmark.browser.query": [
    { name: "fields", optional: true, kind: "unknown" },
    { name: "selector", optional: false, kind: "string" },
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.browser.read": [
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.browser.screenshot": [
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.browser.session.load": [
    { name: "handle", optional: false, kind: "string" },
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.browser.session.save": [
    { name: "handle", optional: false, kind: "string" },
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.browser.style": [
    { name: "addClasses", optional: true, kind: "array" },
    { name: "injectCss", optional: true, kind: "string" },
    { name: "ref", optional: true, kind: "string" },
    { name: "removeClasses", optional: true, kind: "array" },
    { name: "selector", optional: true, kind: "string" },
    { name: "set", optional: true, kind: "object" },
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.browser.wait": [
    { name: "navigationId", optional: true, kind: "string" },
    { name: "tabId", optional: true, kind: "string" },
    { name: "timeoutMs", optional: true, kind: "number" },
  ],
  "vmark.browser.wait_for": [
    { name: "name", optional: true, kind: "string" },
    { name: "ref", optional: true, kind: "string" },
    { name: "role", optional: true, kind: "string" },
    { name: "tabId", optional: true, kind: "string" },
    { name: "text", optional: true, kind: "string" },
    { name: "timeoutMs", optional: true, kind: "number" },
    { name: "urlContains", optional: true, kind: "string" },
  ],
  "vmark.browser.workflow_cancel": [
    { name: "runId", optional: false, kind: "string" },
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.browser.workflow_record": [
    { name: "recordOp", optional: false, kind: "string" },
    { name: "site", optional: true, kind: "string" },
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.browser.workflow_run": [
    { name: "allowRepeat", optional: true, kind: "boolean" },
    { name: "inputs", optional: true, kind: "object" },
    { name: "resumeRunId", optional: true, kind: "string" },
    { name: "source", optional: false, kind: "string" },
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.browser.workflow_status": [
    { name: "runId", optional: false, kind: "string" },
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.coherence.claims": [
    { name: "workspace_root", optional: false, kind: "string" },
  ],
  "vmark.coherence.contexts": [
    { name: "workspace_root", optional: false, kind: "string" },
  ],
  "vmark.coherence.edges": [
    { name: "workspace_root", optional: false, kind: "string" },
  ],
  "vmark.coherence.resolve": [
    { name: "input", optional: false, kind: "unknown" },
    { name: "reason", optional: true, kind: "unknown" },
    { name: "resolution", optional: false, kind: "unknown" },
    { name: "txf", optional: false, kind: "unknown" },
    { name: "workspace_root", optional: false, kind: "string" },
  ],
  "vmark.coherence.status": [
    { name: "workspace_root", optional: false, kind: "string" },
  ],
  "vmark.document.read": [
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.document.transform": [
    { name: "expected_revision", optional: true, kind: "string" },
    { name: "kind", optional: false, kind: "string" },
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.document.write": [
    { name: "content", optional: false, kind: "string" },
    { name: "expected_revision", optional: true, kind: "string" },
    { name: "save", optional: true, kind: "boolean" },
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.selection.get": [
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.selection.set": [
    { name: "content", optional: false, kind: "string" },
    { name: "expected_revision", optional: true, kind: "string" },
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.session.get_state": [
    { name: "clientProtocol", optional: true, kind: "string" },
  ],
  "vmark.workflow.apply_patch": [
    { name: "expected_revision", optional: true, kind: "string" },
    { name: "patches", optional: false, kind: "array" },
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.workflow.validate": [
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.workspace.close": [
    { name: "force", optional: true, kind: "boolean" },
    { name: "tabId", optional: false, kind: "string" },
  ],
  "vmark.workspace.focus_window": [
    { name: "windowLabel", optional: false, kind: "string" },
  ],
  "vmark.workspace.new": [
    { name: "kind", optional: true, kind: "string" },
    { name: "windowLabel", optional: true, kind: "string" },
  ],
  "vmark.workspace.open": [
    { name: "filePath", optional: false, kind: "string" },
    { name: "windowLabel", optional: true, kind: "string" },
  ],
  "vmark.workspace.open_workspace": [
    { name: "folderPath", optional: false, kind: "string" },
  ],
  "vmark.workspace.save": [
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.workspace.save_as": [
    { name: "filePath", optional: false, kind: "string" },
    { name: "tabId", optional: true, kind: "string" },
  ],
  "vmark.workspace.switch_tab": [
    { name: "tabId", optional: false, kind: "string" },
  ],
} as const satisfies Record<string, readonly BridgeFieldDescriptor[]>;

/** Unknown-field posture per operation (chosen per class; ledger D5). */
export const BRIDGE_OPERATION_POSTURE = {
  "vmark.browser.act": "reject",
  "vmark.browser.close": "reject",
  "vmark.browser.console": "reject",
  "vmark.browser.execute_js": "reject",
  "vmark.browser.extract": "reject",
  "vmark.browser.navigate": "reject",
  "vmark.browser.open": "reject",
  "vmark.browser.query": "reject",
  "vmark.browser.read": "reject",
  "vmark.browser.screenshot": "reject",
  "vmark.browser.session.load": "reject",
  "vmark.browser.session.save": "reject",
  "vmark.browser.style": "reject",
  "vmark.browser.wait": "reject",
  "vmark.browser.wait_for": "reject",
  "vmark.browser.workflow_cancel": "reject",
  "vmark.browser.workflow_record": "reject",
  "vmark.browser.workflow_run": "reject",
  "vmark.browser.workflow_status": "reject",
  "vmark.coherence.claims": "reject",
  "vmark.coherence.contexts": "reject",
  "vmark.coherence.edges": "reject",
  "vmark.coherence.resolve": "reject",
  "vmark.coherence.status": "reject",
  "vmark.document.read": "reject",
  "vmark.document.transform": "reject",
  "vmark.document.write": "reject",
  "vmark.selection.get": "reject",
  "vmark.selection.set": "reject",
  "vmark.session.get_state": "strip-and-log",
  "vmark.workflow.apply_patch": "reject",
  "vmark.workflow.validate": "reject",
  "vmark.workspace.close": "reject",
  "vmark.workspace.focus_window": "reject",
  "vmark.workspace.new": "reject",
  "vmark.workspace.open": "reject",
  "vmark.workspace.open_workspace": "reject",
  "vmark.workspace.save": "reject",
  "vmark.workspace.save_as": "reject",
  "vmark.workspace.switch_tab": "reject",
} as const satisfies Record<keyof typeof BRIDGE_OPERATION_FIELDS, UnknownFieldPosture>;

/** Payload argument types per operation (the `type` discriminant excluded). */
export interface BridgeOperationArgs {
  "vmark.browser.act": {
    dy?: number;
    key?: string;
    modifiers?: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean };
    name?: string;
    operation: string;
    ref?: string;
    role?: string;
    tabId?: string;
    text?: string;
  };
  "vmark.browser.close": {
    tabId: string;
  };
  "vmark.browser.console": {
    clear?: boolean;
    tabId?: string;
  };
  "vmark.browser.execute_js": {
    script: string;
    tabId?: string;
  };
  "vmark.browser.extract": {
    tabId?: string;
  };
  "vmark.browser.navigate": {
    tabId?: string;
    timeoutMs?: number;
    url: string;
  };
  "vmark.browser.open": {
    profile?: string;
    timeoutMs?: number;
    url: string;
  };
  "vmark.browser.query": {
    fields?: unknown;
    selector: string;
    tabId?: string;
  };
  "vmark.browser.read": {
    tabId?: string;
  };
  "vmark.browser.screenshot": {
    tabId?: string;
  };
  "vmark.browser.session.load": {
    handle: string;
    tabId?: string;
  };
  "vmark.browser.session.save": {
    handle: string;
    tabId?: string;
  };
  "vmark.browser.style": {
    addClasses?: string[];
    injectCss?: string;
    ref?: string;
    removeClasses?: string[];
    selector?: string;
    set?: Record<string, string>;
    tabId?: string;
  };
  "vmark.browser.wait": {
    navigationId?: string;
    tabId?: string;
    timeoutMs?: number;
  };
  "vmark.browser.wait_for": {
    name?: string;
    ref?: string;
    role?: string;
    tabId?: string;
    text?: string;
    timeoutMs?: number;
    urlContains?: string;
  };
  "vmark.browser.workflow_cancel": {
    runId: string;
    tabId?: string;
  };
  "vmark.browser.workflow_record": {
    recordOp: string;
    site?: string;
    tabId?: string;
  };
  "vmark.browser.workflow_run": {
    allowRepeat?: boolean;
    inputs?: Record<string, string>;
    resumeRunId?: string;
    source: string;
    tabId?: string;
  };
  "vmark.browser.workflow_status": {
    runId: string;
    tabId?: string;
  };
  "vmark.coherence.claims": {
    workspace_root: string;
  };
  "vmark.coherence.contexts": {
    workspace_root: string;
  };
  "vmark.coherence.edges": {
    workspace_root: string;
  };
  "vmark.coherence.resolve": {
    input: unknown;
    reason?: unknown;
    resolution: unknown;
    txf: unknown;
    workspace_root: string;
  };
  "vmark.coherence.status": {
    workspace_root: string;
  };
  "vmark.document.read": {
    tabId?: string;
  };
  "vmark.document.transform": {
    expected_revision?: string;
    kind: string;
    tabId?: string;
  };
  "vmark.document.write": {
    content: string;
    expected_revision?: string;
    save?: boolean;
    tabId?: string;
  };
  "vmark.selection.get": {
    tabId?: string;
  };
  "vmark.selection.set": {
    content: string;
    expected_revision?: string;
    tabId?: string;
  };
  "vmark.session.get_state": {
    clientProtocol?: string;
  };
  "vmark.workflow.apply_patch": {
    expected_revision?: string;
    patches: unknown[];
    tabId?: string;
  };
  "vmark.workflow.validate": {
    tabId?: string;
  };
  "vmark.workspace.close": {
    force?: boolean;
    tabId: string;
  };
  "vmark.workspace.focus_window": {
    windowLabel: string;
  };
  "vmark.workspace.new": {
    kind?: string;
    windowLabel?: string;
  };
  "vmark.workspace.open": {
    filePath: string;
    windowLabel?: string;
  };
  "vmark.workspace.open_workspace": {
    folderPath: string;
  };
  "vmark.workspace.save": {
    tabId?: string;
  };
  "vmark.workspace.save_as": {
    filePath: string;
    tabId?: string;
  };
  "vmark.workspace.switch_tab": {
    tabId: string;
  };
}
