/**
 * How a command reports a failure it has decided to contain.
 *
 * Purpose: ONE definition of "log it AND tell the user" (audit #897, #900,
 * #921, #922, #953). A command body that catches its own failure and only logs
 * it leaves the click doing nothing at all: `menuError` writes to the log file,
 * which nobody reads mid-session, and the palette route drops a rejection
 * entirely. Every one of those sites had been written by hand, and they had
 * drifted — the Pandoc export toasted, the four other exports did not; the help
 * links toasted, the Genies folder did not; Open Workspace logged, Close
 * Workspace did neither and rejected through the bus.
 *
 * NO KEY OF ITS OWN by default. The plugin's or backend's own message is the
 * honest thing to show for "the opener refused this scheme" or "the export
 * chunk would not load", and inventing a generic string per call site is how
 * ten near-identical keys accumulate. `message` is for the cases where a
 * specific, translated sentence genuinely tells the user more — Pandoc's
 * "install Pandoc" being the example.
 *
 * @coordinates-with src/services/commands/exportCommands.ts — every export's contained failure
 * @coordinates-with src/services/commands/miscCommands.ts — help links, Genies folder
 * @coordinates-with src/services/commands/workspaceCommands.ts — close-workspace failures
 * @module services/commands/commandFailure
 */
import { menuError } from "@/utils/debug";
import { imeToast as toast } from "@/services/ime/imeToast";
import { commandErrorMessage } from "./commandError";

export interface CommandFailureReport {
  /** Log prefix naming what failed. */
  label: string;
  /** A translated sentence that beats the raw error; omit to show the error. */
  message?: string | undefined;
  /** The domain's logger; defaults to the command layer's own. */
  log?: (...args: unknown[]) => void;
}

/** Log a contained command failure and show it to the user. */
export function reportCommandFailure(
  error: unknown,
  { label, message, log = menuError }: CommandFailureReport,
): void {
  log(label, error);
  // `commandErrorMessage`, never `String(error)`: a typed CommandError is a
  // plain object and renders as "[object Object]" (.claude/rules/50).
  toast.error(message ?? commandErrorMessage(error));
}
