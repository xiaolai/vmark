/**
 * CommandBus public surface — ADR-012.
 */

export {
  registerCommand,
  unregisterCommand,
  getCommand,
  listCommands,
  executeCommand,
  searchCommands,
  _resetCommandBus,
} from "./CommandBus";
export type {
  CommandDefinition,
  CommandContext,
  CommandScope,
  RankedCommand,
} from "./CommandBus";
export { bridgeActionRegistry, _resetActionBridge } from "./actionBridge";
