/**
 * createTerminalSession — THE owner-aware creation service.
 *
 * Purpose: every production creator of a terminal session goes through this
 * one function, so "resolve the owner, stamp the options" cannot drift
 * between call sites — the panel/init auto-create, the tab bar's +,
 * "Open Terminal Here", and Run-in-Terminal's reuse-or-create all did it by
 * hand before. `canCreateTerminalSessionHere` is the AUTHORITATIVE can-create
 * predicate: it computes the same creation-time union (D-T5) the store's cap
 * gate applies, owner included, so a UI gate can never say yes while creation
 * says no.
 *
 * @coordinates-with stores/terminalStore/sessionActions.ts — terminalCreateSession + creationUnion
 * @coordinates-with resolveTerminalOwnerInstanceId.ts — the D-T1 carve-outs
 * @module services/terminal/createTerminalSession
 */
import { creationUnion } from "@/stores/terminalStore/sessionActions";
import { MAX_TERMINAL_SESSIONS, useTerminalStore, type TerminalSession } from "@/stores/terminalStore";
import { resolveTerminalOwnerInstanceId } from "./resolveTerminalOwnerInstanceId";

/** Whether a session created NOW in this window would pass the cap gate —
 *  the SAME union the store applies, owner and all (never a bare count). */
export function canCreateTerminalSessionHere(windowLabel: string): boolean {
  const owner = resolveTerminalOwnerInstanceId(windowLabel);
  const sessions = useTerminalStore.getState().sessions;
  return creationUnion(sessions, owner).length < MAX_TERMINAL_SESSIONS;
}

/** Create a session in the active scope (owner stamped per D-T1's carve-outs).
 *  Returns null at the creation-union cap, exactly like the store action. */
export function createTerminalSessionInScope(
  windowLabel: string,
  options?: Pick<TerminalSession, "requestedCwd" | "windowsShell" | "pendingCode">,
): TerminalSession | null {
  const owner = resolveTerminalOwnerInstanceId(windowLabel);
  return useTerminalStore.getState().terminalCreateSession({
    ...(options?.requestedCwd ? { requestedCwd: options.requestedCwd } : {}),
    ...(options?.windowsShell ? { windowsShell: options.windowsShell } : {}),
    ...(options?.pendingCode !== undefined ? { pendingCode: options.pendingCode } : {}),
    ...(owner ? { ownerInstanceId: owner } : {}),
  });
}
