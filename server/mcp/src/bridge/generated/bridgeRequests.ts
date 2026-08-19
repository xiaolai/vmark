/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source of truth: src/bridge/operationSchemas.ts
 * Regenerate with: pnpm gen:mcp-contracts
 *
 * A hand-edit here fails `pnpm lint:mcp-contracts` (WI-15).
 */

/** Every command the MCP server can send over the bridge. */
export type BridgeRequest =
  | {
      type: 'vmark.browser.act';
      dy?: number;
      key?: string;
      modifiers?: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean };
      name?: string;
      operation: string;
      ref?: string;
      role?: string;
      tabId?: string;
      text?: string;
    }
  | {
      type: 'vmark.browser.console';
      clear?: boolean;
      tabId?: string;
    }
  | {
      type: 'vmark.browser.execute_js';
      script: string;
      tabId?: string;
    }
  | {
      type: 'vmark.browser.navigate';
      tabId?: string;
      timeoutMs?: number;
      url: string;
    }
  | {
      type: 'vmark.browser.open';
      profile?: string;
      timeoutMs?: number;
      url: string;
    }
  | {
      type: 'vmark.browser.query';
      fields?: unknown;
      selector: string;
      tabId?: string;
    }
  | {
      type: 'vmark.browser.read';
      tabId?: string;
    }
  | {
      type: 'vmark.browser.screenshot';
      tabId?: string;
    }
  | {
      type: 'vmark.browser.session.load';
      handle: string;
      tabId?: string;
    }
  | {
      type: 'vmark.browser.session.save';
      handle: string;
      tabId?: string;
    }
  | {
      type: 'vmark.browser.style';
      addClasses?: string[];
      injectCss?: string;
      ref?: string;
      removeClasses?: string[];
      selector?: string;
      set?: Record<string, string>;
      tabId?: string;
    }
  | {
      type: 'vmark.browser.wait';
      navigationId?: string;
      tabId?: string;
      timeoutMs?: number;
    }
  | {
      type: 'vmark.browser.wait_for';
      name?: string;
      ref?: string;
      role?: string;
      tabId?: string;
      text?: string;
      timeoutMs?: number;
      urlContains?: string;
    }
  | {
      type: 'vmark.coherence.claims';
      workspace_root: string;
    }
  | {
      type: 'vmark.coherence.contexts';
      workspace_root: string;
    }
  | {
      type: 'vmark.coherence.edges';
      workspace_root: string;
    }
  | {
      type: 'vmark.coherence.resolve';
      input: unknown;
      reason?: unknown;
      resolution: unknown;
      txf: unknown;
      workspace_root: string;
    }
  | {
      type: 'vmark.coherence.status';
      workspace_root: string;
    }
  | {
      type: 'vmark.document.read';
      tabId?: string;
    }
  | {
      type: 'vmark.document.transform';
      expected_revision?: string;
      kind: string;
      tabId?: string;
    }
  | {
      type: 'vmark.document.write';
      content: string;
      expected_revision?: string;
      save?: boolean;
      tabId?: string;
    }
  | {
      type: 'vmark.selection.get';
      tabId?: string;
    }
  | {
      type: 'vmark.selection.set';
      content: string;
      expected_revision?: string;
      tabId?: string;
    }
  | {
      type: 'vmark.session.get_state';
      clientProtocol?: string;
    }
  | {
      type: 'vmark.workflow.apply_patch';
      expected_revision?: string;
      patches: unknown[];
      tabId?: string;
    }
  | {
      type: 'vmark.workflow.validate';
      tabId?: string;
    }
  | {
      type: 'vmark.workspace.close';
      force?: boolean;
      tabId: string;
    }
  | {
      type: 'vmark.workspace.focus_window';
      windowLabel: string;
    }
  | {
      type: 'vmark.workspace.new';
      kind?: string;
      windowLabel?: string;
    }
  | {
      type: 'vmark.workspace.open';
      filePath: string;
      windowLabel?: string;
    }
  | {
      type: 'vmark.workspace.open_workspace';
      folderPath: string;
    }
  | {
      type: 'vmark.workspace.save';
      tabId?: string;
    }
  | {
      type: 'vmark.workspace.save_as';
      filePath: string;
      tabId?: string;
    }
  | {
      type: 'vmark.workspace.switch_tab';
      tabId: string;
    }
  ;
