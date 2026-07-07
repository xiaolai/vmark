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

/** Unregister a command (e.g., on plugin teardown). */
export function unregisterCommand(id: string): void {
  REGISTRY.delete(id);
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
  if (command.when && !command.when(ctx)) return false;
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
    if (command.when && !command.when(ctx)) continue;
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
}
