/**
 * Resilience hooks — the React-adapter layer over the persistence resilience
 * services (crash-recovery + hot-exit). Logic lives in
 * `services/persistence/resilience/`; these hooks own only lifecycle (ADR-013).
 *
 * Consumers import only useDocumentResilience + useResilienceStartup.
 * @module hooks/resilience
 */

export { useDocumentResilience, useResilienceStartup } from "./useDocumentResilience";
