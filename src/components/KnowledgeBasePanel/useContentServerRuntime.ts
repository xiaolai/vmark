/**
 * useContentServerRuntime (WI-FL1.1) — probes `content_server_runtime` when the
 * panel mounts and on demand, and holds the result as a `RuntimeProbe`.
 *
 * Purpose: the React adapter between the service probe and the panel. It never
 * starts a server and never touches `contentServerStore` — the probe is a
 * question about the machine, not a lifecycle transition, and the store's
 * `status` keeps meaning "what the server is doing".
 *
 * A rejected probe is `failed` with the command's message; a payload that is
 * not the wire shape is `failed` too (see `runtimeState.ts`). Either way the
 * panel keeps the start path — the probe is advisory, and the start's own
 * errors are the authority once the user asks for one.
 *
 * @coordinates-with ./runtimeState.ts — the state shape and payload guard
 * @coordinates-with src/services/contentServer/client.ts — `getContentServerRuntime`
 * @module components/KnowledgeBasePanel/useContentServerRuntime
 */
import { useCallback, useEffect, useState } from "react";
import { commandErrorMessage } from "@/services/commands/commandError";
import { getContentServerRuntime } from "@/services/contentServer";
import { isContentServerRuntime, type RuntimeProbe } from "./runtimeState";

export interface ContentServerRuntimeProbe {
  probe: RuntimeProbe;
  /** Run the probe again — after installing Node.js, say. */
  recheck: () => void;
}

export function useContentServerRuntime(): ContentServerRuntimeProbe {
  const [probe, setProbe] = useState<RuntimeProbe>({ phase: "checking" });
  const [attempt, setAttempt] = useState(0);

  const recheck = useCallback(() => {
    setProbe({ phase: "checking" });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getContentServerRuntime()
      .then((report) => {
        if (cancelled) return;
        setProbe(
          isContentServerRuntime(report)
            ? { phase: "known", runtime: report }
            : { phase: "failed", message: "content_server_runtime returned no report" },
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) setProbe({ phase: "failed", message: commandErrorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { probe, recheck };
}
