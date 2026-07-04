/**
 * Barrel for the content-server service. Pure re-export — implementation
 * (and its tests) live in `./client.ts` so coverage tracks the real code
 * (`vitest.config.ts` excludes all `index.ts` barrels from coverage).
 *
 * @module services/contentServer
 */

export * from "./client";
