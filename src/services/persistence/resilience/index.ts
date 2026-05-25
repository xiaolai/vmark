/**
 * Resilience public surface — T07.
 *
 * Consumers import only useDocumentResilience + the machine types.
 * The _* internal helpers are not exported.
 */

export {
  useDocumentResilience,
  useResilienceStartup,
} from "./useDocumentResilience";
export type { ResilienceState, ResilienceMachine } from "./machine";
export {
  createResilienceMachine,
  isLegalTransition,
} from "./machine";
