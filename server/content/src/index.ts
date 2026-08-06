/**
 * @vmark/content-server public API.
 *
 * @module index
 */

export { renderMarkdown, sanitizeHtml } from "./render/renderMarkdown.js";
export { buildIndex, type WorkspaceIndex } from "./index/buildIndex.js";
export { walkWorkspace } from "./index/walk.js";
export { watchWorkspace } from "./index/watch.js";
export { startKbServer, type RunningKbServer } from "./server/runtime.js";
export { createContentServer } from "./server/createServer.js";
export { detectSlidevDeck } from "./slidev/detect.js";
export { startSlidevServer } from "./slidev/server.js";
