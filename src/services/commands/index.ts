/**
 * CommandBus public surface — ADR-012.
 */

export { executeCommand, searchCommands } from "./CommandBus";
export type { RankedCommand, CommandContext } from "./CommandBus";
export { resolveLocalizedString } from "./CommandBus";
// useCommandBootstrap is a React hook — it lives in hooks/ (ADR-013), not here.
