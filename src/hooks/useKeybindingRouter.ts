/**
 * useKeybindingRouter — the WINDOW capture adapter over the binding registry
 * (ADR-018, keybinding Phase 3).
 *
 * Owns ONE `window` keydown listener. On each event it builds the scope context,
 * resolves the winning `window`-owned binding, applies the binding's per-policy
 * IME + repeat gates and consumption, and executes commands through the bus
 * (`executeCommand`) — the single invariant. `containment` bindings only consume
 * (browser-default guards, no command). Replaces the scattered per-shortcut
 * `window` hooks one migration slice at a time (see `keybindingDefinitions.ts`).
 *
 * @coordinates-with services/keybinding/keybindingRegistry.ts — resolution
 * @coordinates-with services/commands/CommandBus.ts — command execution
 * @module hooks/useKeybindingRouter
 */

import { useEffect } from "react";
import { useWindowLabel } from "@/contexts/WindowContext";
import { executeCommand } from "@/services/commands";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { keybindingWarn } from "@/utils/debug";
import { installBindings, resolveEvent } from "@/services/keybinding/keybindingRegistry";
import { resolveBindingContext } from "@/services/keybinding/bindingContext";
import { KEYBINDINGS } from "@/services/keybinding/keybindingDefinitions";
import { AmbiguousBindingError, type Binding } from "@/services/keybinding/bindingRegistry";

/** Whether the binding's IME policy says to skip this event. */
function skipForIme(event: KeyboardEvent, ime: Binding["ime"]): boolean {
  if (ime === "editor-local") return false; // editor adapters own composition
  const composing = isImeKeyEvent(event);
  if (ime === "block") return composing;
  // "chord-exempt": only skip a REAL composition, not the keyCode-229 false
  // positive on a command chord (so e.g. Ctrl+` fires under a CJK IME).
  return composing && event.isComposing === true;
}

export function useKeybindingRouter(): void {
  const windowLabel = useWindowLabel();

  useEffect(() => {
    const dispose = installBindings(KEYBINDINGS);

    // One handler for each DOM phase. The winning binding's `windowPhase`
    // decides which phase acts on it (default bubble), so a chord fires exactly
    // once — the other phase resolves the same winner and skips it.
    const handle = (phase: "capture" | "bubble") => (event: KeyboardEvent) => {
      const ctx = resolveBindingContext(windowLabel);
      let resolved;
      try {
        resolved = resolveEvent(event, ctx, "window");
      } catch (err) {
        if (err instanceof AmbiguousBindingError) {
          keybindingWarn(err.message);
          return;
        }
        throw err;
      }
      if (!resolved) return;

      const binding = resolved.binding;
      if ((binding.windowPhase ?? "bubble") !== phase) return; // other phase owns it
      if (skipForIme(event, binding.ime)) return;
      if (binding.repeat === "deny" && event.repeat) return;

      if (binding.consumption !== "passthrough") event.preventDefault();
      if (binding.consumption === "preventAndStop") event.stopPropagation();

      if (binding.kind === "command") {
        void executeCommand(binding.commandId, null, ctx).catch((err) =>
          keybindingWarn(`Command ${binding.commandId} threw:`, err),
        );
      }
      // containment: consumed, nothing to execute.
    };

    const onBubble = handle("bubble");
    const onCapture = handle("capture");
    window.addEventListener("keydown", onBubble);
    window.addEventListener("keydown", onCapture, { capture: true });
    return () => {
      window.removeEventListener("keydown", onBubble);
      window.removeEventListener("keydown", onCapture, { capture: true });
      dispose();
    };
  }, [windowLabel]);
}
