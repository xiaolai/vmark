/**
 * Genie invocation lifecycle (audit 20260907, #309/#310).
 *
 * The picker used to close itself BEFORE invoking a genie, so `isOpen` was
 * false by the time the stream runner moved the store to processing/preview/
 * error — the inline response view (website/guide/ai-genies.md "Processing
 * Feedback") could never render. The picker now stays open through the
 * invocation; this helper closes it only when the invocation settles without
 * ever having entered a response mode — a workflow genie, a provider or scope
 * refusal, the invocation lock busy — since those have nothing to show. A
 * response mode keeps the picker open until the user accepts, retries or
 * dismisses; the auto-approve path closes it from the runner as before.
 *
 * @coordinates-with src/components/GeniePicker/GeniePicker.tsx — the caller
 * @coordinates-with src/services/genieInvocation/streamRunner.ts — sets the response modes
 * @module components/GeniePicker/invocationLifecycle
 */
import { useGeniePickerStore, type PickerMode } from "@/stores/geniePickerStore";

const RESPONSE_MODES: ReadonlySet<PickerMode> = new Set(["processing", "preview", "error"]);

export function isResponseMode(mode: PickerMode): boolean {
  return RESPONSE_MODES.has(mode);
}

/**
 * Run an invocation with the picker open; log a rejection; close the picker
 * once it settles if it never reached a response mode.
 *
 * `run` is a THUNK, not a promise (audit R3 #623). Passing the promise meant
 * the caller evaluated it first, so an invocation that threw SYNCHRONOUSLY —
 * a bad scope, a provider lookup that blows up before its first await —
 * propagated out of the call and reached neither `onError` nor the close
 * below: the picker sat open on a search box with nothing happening.
 *
 * It is still called SYNCHRONOUSLY, inside a try, rather than deferred with
 * `Promise.resolve().then(run)`. Deferring would move the invocation off the
 * user's click task for no benefit, and the callers dispatch from a key or
 * click handler.
 *
 * `stillOwnsPicker` is the invocation's claim on the SESSION it started in.
 * Everything before `startProcessing` is awaited — `ensureProvider()` can go to
 * the backend — so a user who cancels during that window and reopens the
 * picker has a NEW session on screen when the old invocation finally settles.
 * The mode is then `search`, not a response mode, and the close below shut a
 * picker the old invocation had nothing to do with (audit R2, #610/#624). The
 * default keeps the helper usable where there is no session to name.
 */
export function settleInvocation(
  run: () => Promise<unknown> | unknown,
  onError: (e: unknown) => void,
  stillOwnsPicker: () => boolean = () => true,
): Promise<void> {
  // Invoked SYNCHRONOUSLY: an async function's body runs to its first `await`,
  // and there is none here, so the invocation still starts in the user's click
  // task. A synchronous throw becomes this promise's rejection instead of
  // escaping the call (#623).
  const started = (async () => run())();
  return started
    .then(() => undefined, onError)
    .finally(() => {
      if (!stillOwnsPicker()) return;
      const picker = useGeniePickerStore.getState();
      if (!isResponseMode(picker.mode)) picker.closePicker();
    });
}
