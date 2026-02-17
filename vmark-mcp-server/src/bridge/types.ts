/**
 * Bridge types barrel — re-exports all types for backward compatibility.
 *
 * Types are split into focused modules:
 *   - core-types.ts: Bridge, BridgeRequest, BridgeResponse
 *   - document-types.ts: Selection, Heading, Metadata, format/block/list types, search/edit results, suggestions
 *   - protocol-types.ts: AST, structured errors, capabilities, mutations, sections, paragraphs, tables, lists
 *   - workspace-types.ts: Window, Tab, Workspace info
 */

export * from './core-types.js';
export * from './document-types.js';
export * from './protocol-types.js';
export * from './workspace-types.js';
