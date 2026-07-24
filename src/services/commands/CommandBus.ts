/**
 * CommandBus — single intent path (ADR-012).
 *
 * One bus owns registration, availability checks, ranking (for palette),
 * and execution. Menu dispatcher, shortcut router, command palette, MCP
 * bridge, and programmatic callers all consume the bus.
 *
 * Foundation-only: the existing `actionRegistry` data layer
 * (`src/plugins/actions/actionRegistry.ts`) continues to back the menu
 * dispatcher. CommandBus adds the missing layer above it — a generic
 * register/execute/search surface that downstream code can adopt
 * incrementally. The 6 legacy `use*MenuEvents` hooks remain in place
 * until they migrate one PR at a time per the staged plan in ADR-012.
 *
 * @module services/commands/CommandBus
 */

import { menuError } from "@/utils/debug";

type CommandScope = "global" | "editor" | "panel";

export interface CommandContext {
  /** Free-form context passed by callers (active editor, selection, …). */
  [key: string]: unknown;
}

/**
 * Localized-string source. Pass a plain string for English-only labels,
 * or a getter function that resolves through i18n at display time —
 * useful when commands register synchronously before non-boot
 * namespaces are loaded.
 */
export type LocalizedString = string | (() => string);

export interface CommandDefinition {
  id: string;
  /** Human-readable label shown in palette / accessibility surfaces. */
  title: LocalizedString;
  /** Optional description for palette rows + tooltips. */
  description?: LocalizedString;
  /** Optional category for grouping (palette section, menu group). */
  category?: string;
  /** Default scope; palette filters by current scope. */
  scope?: CommandScope;
  /** Optional availability check; commands whose `when` returns false are filtered out. */
  when?: (ctx: CommandContext) => boolean;
  /** Action body. May be async. */
  run: (args: unknown, ctx: CommandContext) => void | Promise<void>;
}

/** Resolve a LocalizedString to a plain string at the moment of display. */
export function resolveLocalizedString(value: LocalizedString | undefined): string {
  if (value === undefined) return "";
  return typeof value === "function" ? value() : value;
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
/** Monotonic generation per owner, so a STALE disposer (from a superseded batch)
 * cannot remove the owner's current live batch. */
const OWNER_GENERATION = new Map<string, number>();

/**
 * Atomically (re)register a batch of commands under an `owner` token; returns a
 * disposer. HMR-safe:
 *  - PREFLIGHT: throw BEFORE registering anything (so a rejected batch never
 *    leaves a partial state) if the batch contains a DUPLICATE id, or an id
 *    already registered by a DIFFERENT owner (or by a plain `registerCommand`).
 *  - REPLACE-OWN: the owner's previous batch is removed first, so a double
 *    bootstrap, an HMR reload, or a partial prior batch all converge to exactly
 *    this batch.
 *  - GENERATION-SCOPED DISPOSER: each register bumps the owner's generation; the
 *    returned disposer removes the batch ONLY while it is still current, so an
 *    out-of-order cleanup of a superseded batch can't tear down the live one.
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
  const generation = (OWNER_GENERATION.get(owner) ?? 0) + 1;
  OWNER_GENERATION.set(owner, generation);
  return () => {
    if (OWNER_GENERATION.get(owner) === generation) unregisterOwner(owner);
  };
}

/** Remove every command registered under an `owner` token. Idempotent. */
export function unregisterOwner(owner: string): void {
  for (const [id, o] of OWNERS) {
    if (o === owner) {
      REGISTRY.delete(id);
      OWNERS.delete(id);
    }
  }
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
 * Whether a command id is already registered. Registrar modules use this
 * as an HMR-safe guard: their module-local `registered` flag resets when
 * Vite re-instantiates the module, but this registry survives in the
 * module graph, so a sentinel-id check makes re-registration a no-op.
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
  const q = query.trim().toLowerCase();
  const results: RankedCommand[] = [];

  for (const command of REGISTRY.values()) {
    if (!isCommandAvailable(command, ctx)) continue;
    if (!q) {
      results.push({ command, score: 0 });
      continue;
    }
    const title = resolveLocalizedString(command.title).toLowerCase();
    const id = command.id.toLowerCase();
    const desc = resolveLocalizedString(command.description).toLowerCase();

    let score = 0;
    if (title.startsWith(q)) score = 100;
    else if (title.includes(q)) score = 50;
    else if (id.includes(q)) score = 25;
    else if (desc.includes(q)) score = 10;

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
