/**
 * Shared wire-field primitives for the bridge operation schemas — the
 * spellings BOTH `operationSchemas.ts` and `operationSchemas.browser.ts` build
 * their `z.object`s from.
 *
 * Purpose: give the two schema maps one declaration of each shared field
 * shape, without a module cycle. `operationSchemas.ts` spreads the browser map
 * into the full contract, so the browser module could not import these back
 * from it; the file-size split (WI-NB4.1) re-spelled `id` and `optionalTabId`
 * locally instead — two declarations of one contract, which is the drift this
 * directory exists to end (audit row #170). This module depends on zod alone,
 * so both maps import it and neither imports the other's helpers.
 *
 * Key decisions:
 *   - Only SHARED spellings live here. A helper one map uses alone
 *     (`revision`, `timeoutMs`) stays beside that map, where its meaning is.
 *   - Instances are exported, not factories, so the maps share one object per
 *     spelling; `operationSchemaPrimitives.test.ts` pins that identity, which
 *     is the only thing that tells "shared" from "copied" — a copy parses the
 *     same.
 *
 * @coordinates-with bridge/operationSchemas.ts — editor/coherence operations
 * @coordinates-with bridge/operationSchemas.browser.ts — browser operations
 * @module bridge/operationSchemas.primitives
 */
import { z } from 'zod';

/** A required identifier-like string: a tab id, a window label, a path, a URL, a handle. */
export const id = z.string();

/**
 * The optional tab target a tab-scoped operation carries. Absent means the
 * focused tab; the tools refuse a blank one before it reaches the wire.
 */
export const optionalTabId = z.string().optional();
