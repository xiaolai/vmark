/**
 * createTerminalSession — THE owner-aware creation service (audit 20260831
 * #17/#20).
 *
 * Purpose: every production creator of a terminal session goes through this
 * one function, so "resolve the owner, stamp the options" cannot drift
 * between call sites — the panel/init auto-create, the tab bar's +,
 * "Open Terminal Here", and Run-in-Terminal's reuse-or-create all did it by
 * hand before. `canCreateTerminalSessionHere` is the AUTHORITATIVE can-create
 * predicate: it computes the same creation-time union (D-T5) the slice's cap
 * gate applies, owner included, so a UI gate can never say yes while creation
 * says no.
 *
 * @coordinates-with stores/uiStore/terminalSlice.ts — terminalCreateSession + creationUnion
 * @coordinates-with resolveTerminalOwnerInstanceId.ts — the D-T1 carve-outs
 * @module services/terminal/createTerminalSession
 */
import { MAX_TERMINAL_SESSIONS, useUIStore } from "@/stores/uiStore";
import { creationUnion } from "@/stores/uiStore/terminalSlice";
import type { TerminalSession } from "@/stores/uiStore/types";
import { resolveTerminalOwnerInstanceId } from "./resolveTerminalOwnerInstanceId";

/** Whether a session created NOW in this window would pass the cap gate —
 *  the SAME union the slice applies, owner and all (never a bare count). */
export function canCreateTerminalSessionHere(windowLabel: string): boolean {
  const owner = resolveTerminalOwnerInstanceId(windowLabel);
  const sessions = useUIStore.getState().terminal.sessions;
  return creationUnion(sessions, owner).length < MAX_TERMINAL_SESSIONS;
}

/** Create a session in the active scope (owner stamped per D-T1's carve-outs).
 *  Returns null at the creation-union cap, exactly like the slice action. */
export function createTerminalSessionInScope(
  windowLabel: string,
  options?: { requestedCwd?: string },
): TerminalSession | null {
  const owner = resolveTerminalOwnerInstanceId(windowLabel);
  return useUIStore.getState().terminalCreateSession({
    ...(options?.requestedCwd ? { requestedCwd: options.requestedCwd } : {}),
    ...(owner ? { ownerInstanceId: owner } : {}),
  });
}
