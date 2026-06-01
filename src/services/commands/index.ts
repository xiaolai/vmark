/**
 * CommandBus public surface — ADR-012.
 */

export { executeCommand, searchCommands } from "./CommandBus";
export type {
  CommandDefinition,
  CommandContext,
  CommandScope,
  LocalizedString,
  RankedCommand,
} from "./CommandBus";
export { resolveLocalizedString } from "./CommandBus";
export { useCommandBootstrap } from "./useCommandBootstrap";
