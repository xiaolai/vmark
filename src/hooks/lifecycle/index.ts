/**
 * Lifecycle composites barrel — T03.
 *
 * Four `use*Lifecycle` composites + two mount components.
 * MainLayout consumes:
 *   - `useWorkspaceLifecycle()` + `useEditorLifecycle()` directly
 *   - `<DocumentWindowMount />` when isDocumentWindow
 *   - `<MainWindowRunners />` when windowLabel === "main"
 */

export { useWorkspaceLifecycle } from "./useWorkspaceLifecycle";
export { useEditorLifecycle } from "./useEditorLifecycle";
export { DocumentWindowMount } from "./DocumentWindowMount";
export { MainWindowRunners } from "./MainWindowRunners";
