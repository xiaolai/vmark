/**
 * CommandBus — single intent path (ADR-012).
 *
 * One bus owns registration, availability checks, ranking (for palette),
 * and execution. Menu dispatcher, shortcut router, command palette, MCP
 * bridge, and programmatic callers all consume the bus.
 *
 * The `actionRegistry` data layer (`src/plugins/actions/actionRegistry.ts`)
 * still backs the menu dispatcher; CommandBus is the layer above it — a
 * generic register/execute/search surface. The six legacy `use*MenuEvents`
 * hooks it was staged to replace are gone (T06): `useCommandBootstrap`
 * registers every command surface once and routes every `menu:*` event
 * through `executeCommand`.
 *
 * @module services/commands/CommandBus
 */

import { menuError } from "@/utils/debug";
import { foldForSearch, resolveLocalizedString, scoreCommand, type LocalizedString } from "./commandText";

// The palette and `services/commands/index.ts` import the resolver from the
// bus; it lives in commandText.ts. The TYPE is not re-exported — no consumer
// names it, and an unused re-export is exactly what the knip gate is for.
export { resolveLocalizedString };

type CommandScope = "global" | "editor" | "panel";

export interface CommandContext {
  /** Free-form context passed by callers (active editor, selection, …). */
  [key: string]: unknown;
}

/**
 * Every field is `readonly` (audit #879). Definitions are stored and handed back
 * BY REFERENCE — `getCommand` and `listCommands` do not copy — so a mutable `id`
 * is a way to desynchronize a definition from the registry key it is filed
 * under, and from the owner claim in `OWNERS`, without going through
 * registration at all. There is no runtime freeze: every registrar is in this
 * repository, so the compiler is the enforcement, and freezing ~200 objects to
 * restate what the type already says would cost more than it protects.
 */
export interface CommandDefinition {
  readonly id: string;
  /** Human-readable label shown in palette / accessibility surfaces. */
  readonly title: LocalizedString;
  /** Optional description for palette rows + tooltips. */
  readonly description?: LocalizedString;
  /** Optional category for grouping (palette section, menu group). */
  readonly category?: string;
  /** Default scope; palette filters by current scope. */
  readonly scope?: CommandScope;
  /** Optional availability check; commands whose `when` returns false are filtered out. */
  readonly when?: (ctx: CommandContext) => boolean;
  /** Action body. May be async. */
  readonly run: (args: unknown, ctx: CommandContext) => void | Promise<void>;
}

export interface RankedCommand {
  command: CommandDefinition;
  score: number;
}

const REGISTRY = new Map<string, CommandDefinition>();

/**
 * Register a command. Throws on duplicate id — registration is the single
 * source of truth, so silent overwrites are forbidden.
 */
export function registerCommand(command: CommandDefinition): void {
  if (REGISTRY.has(command.id)) {
    throw new Error(`Command already registered: ${command.id}`);
  }
  REGISTRY.set(command.id, command);
}

/** Unregister a command (e.g., on plugin teardown). Also clears any owner claim
 * so a later registration of the same id is not mistaken for the stale owner. */
export function unregisterCommand(id: string): void {
  REGISTRY.delete(id);
  OWNERS.delete(id);
}

/**
 * Owner token → set of command ids it registered. Owner-based registration
 * (`registerCommands`) is the HMR-safe path for BATCH registrars like the
 * editor-action bridge, where `hasCommand` is not enough: it can't tell an
 * idempotent re-bootstrap from a foreign collision or recover a partial batch.
 */
const OWNERS = new Map<string, string>();
/** Owner → its CURRENT registration token. A unique `Symbol` per register means a
 * STALE disposer (from a superseded batch — or one retained across a reset) can
 * never match the live token, so it cannot remove the owner's current batch. A
 * numeric counter would be reused after `_resetCommandBus`; a Symbol never is. */
const OWNER_GENERATION = new Map<string, symbol>();

/**
 * Atomically (re)register a batch of commands under an `owner` token; returns a
 * disposer. HMR-safe:
 *  - PREFLIGHT: throw BEFORE registering anything (so a rejected batch never
 *    leaves a partial state) if the batch contains a DUPLICATE id, or an id
 *    already registered by a DIFFERENT owner (or by a plain `registerCommand`).
 *  - REPLACE-OWN: the owner's previous batch is removed first, so a double
 *    bootstrap, an HMR reload, or a partial prior batch all converge to exactly
 *    this batch.
 *  - TOKEN-SCOPED DISPOSER: each register stamps the owner with a fresh Symbol;
 *    the returned disposer removes the batch ONLY while its token is still the
 *    owner's current one, so an out-of-order cleanup of a superseded batch (or a
 *    disposer retained across `_resetCommandBus`) can't tear down the live one.
 */
export function registerCommands(
  owner: string,
  commands: readonly CommandDefinition[],
): () => void {
  const seen = new Set<string>();
  for (const command of commands) {
    if (seen.has(command.id)) {
      throw new Error(`Duplicate command id "${command.id}" within the same batch`);
    }
    seen.add(command.id);
    const existingOwner = OWNERS.get(command.id);
    if (REGISTRY.has(command.id) && existingOwner !== owner) {
      throw new Error(
        `Command id "${command.id}" is already registered by ${existingOwner ?? "another registrar"}`,
      );
    }
  }
  unregisterOwner(owner);
  for (const command of commands) {
    REGISTRY.set(command.id, command);
    OWNERS.set(command.id, owner);
  }
  const token = Symbol(owner);
  OWNER_GENERATION.set(owner, token);
  return () => {
    if (OWNER_GENERATION.get(owner) === token) unregisterOwner(owner);
  };
}

/**
 * Everything a registration attempt can mutate, captured so it can be undone
 * exactly (audit #453). Opaque to callers — the shape is this module's.
 */
export interface CommandRegistrySnapshot {
  readonly commands: ReadonlyArray<readonly [string, CommandDefinition]>;
  readonly owners: ReadonlyArray<readonly [string, string]>;
  readonly generations: ReadonlyArray<readonly [string, symbol]>;
}

/**
 * Snapshot the registry for a transactional registration (audit #453).
 *
 * An id-only snapshot could express "delete what was added" and nothing else,
 * which is not the inverse of what a batch does: `registerCommands` REPLACES
 * its owner's previous batch, so a failure after that point left the bus
 * holding the failed attempt's definitions under a fresh generation token — an
 * id set cannot see either change, and the disposer the previous batch handed
 * out no longer matched, so nothing could remove them.
 */
export function snapshotCommandRegistry(): CommandRegistrySnapshot {
  return {
    commands: [...REGISTRY],
    owners: [...OWNERS],
    generations: [...OWNER_GENERATION],
  };
}

/** Restore a snapshot taken by {@link snapshotCommandRegistry}, exactly. */
export function restoreCommandRegistry(snapshot: CommandRegistrySnapshot): void {
  REGISTRY.clear();
  OWNERS.clear();
  OWNER_GENERATION.clear();
  for (const [id, command] of snapshot.commands) REGISTRY.set(id, command);
  for (const [id, owner] of snapshot.owners) OWNERS.set(id, owner);
  for (const [owner, token] of snapshot.generations) OWNER_GENERATION.set(owner, token);
}

/**
 * Remove every command registered under an `owner` token. Idempotent.
 *
 * The generation token goes with them (audit #881): `OWNER_GENERATION` is
 * documented as the owner's CURRENT token, and an owner with no commands has
 * none. Leaving it behind kept an entry per transient owner forever and left a
 * spent disposer still matching. `registerCommands` calls this before stamping
 * its own token, so the delete is invisible to the replace-own path.
 */
export function unregisterOwner(owner: string): void {
  for (const [id, o] of OWNERS) {
    if (o === owner) {
      REGISTRY.delete(id);
      OWNERS.delete(id);
    }
  }
  OWNER_GENERATION.delete(owner);
}

/**
 * Evaluate a command's `when` predicate defensively: a throwing predicate must
 * NOT crash palette search/render. Treat a failure as "unavailable" and log it
 * with the command id, so one faulty command disables only itself.
 */
function isCommandAvailable(command: CommandDefinition, ctx: CommandContext): boolean {
  if (!command.when) return true;
  try {
    return command.when(ctx);
  } catch (err) {
    menuError(`Command "${command.id}" when() threw; treating as unavailable:`, err);
    return false;
  }
}

/** Get a command definition. */
export function getCommand(id: string): CommandDefinition | undefined {
  return REGISTRY.get(id);
}

/**
 * Whether a command id is already registered. The sentinel-guarded registrar
 * modules use this as their ONLY idempotence guard (#514): this registry
 * survives an HMR reload, where a module-level flag would reset, and it is
 * what the registerAllCommands rollback clears, where a module-level flag
 * would outlive the rollback and skip the retry.
 */
export function hasCommand(id: string): boolean {
  return REGISTRY.has(id);
}

/** Snapshot of every registered command. */
export function listCommands(): CommandDefinition[] {
  return Array.from(REGISTRY.values());
}

/**
 * Execute a command. Returns false if no command with that id exists,
 * or if the command's `when` predicate rejects the current context.
 * Returns true on dispatch (success/failure of the action body is the
 * action's own concern).
 */
export async function executeCommand(
  id: string,
  args: unknown = undefined,
  ctx: CommandContext = {},
): Promise<boolean> {
  const command = REGISTRY.get(id);
  if (!command) return false;
  if (!isCommandAvailable(command, ctx)) return false;
  await command.run(args, ctx);
  return true;
}

/**
 * Substring search over title / id / description. Returns commands sorted
 * by descending score. Availability (`when`) is honored; commands the
 * current context rejects are excluded.
 *
 * Scoring is intentionally simple — palette UIs may layer fuzzy matching
 * on top. Foundation only.
 */
export function searchCommands(query: string, ctx: CommandContext = {}): RankedCommand[] {
  // Both sides go through the SAME fold — case and Unicode canonical form —
  // or "the same text" spelled two ways fails to match (commandSearch.ts).
  const q = foldForSearch(query.trim());
  const results: RankedCommand[] = [];

  for (const command of REGISTRY.values()) {
    if (!isCommandAvailable(command, ctx)) continue;
    if (!q) {
      results.push({ command, score: 0 });
      continue;
    }
    const score = scoreCommand(q, {
      // A command whose title getter throws is LABELLED BY ITS ID rather than
      // dropped: it stays findable, and the palette shows something.
      title: foldForSearch(resolveLocalizedString(command.title, command.id)),
      id: foldForSearch(command.id),
      description: foldForSearch(resolveLocalizedString(command.description)),
    });
    if (score > 0) results.push({ command, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

/** Test-only reset. */
export function _resetCommandBus(): void {
  REGISTRY.clear();
  OWNERS.clear();
  OWNER_GENERATION.clear();
}
