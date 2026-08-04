#!/usr/bin/env tsx
/**
 * MCP contract generator (WI-15) — `pnpm gen:mcp-contracts`.
 *
 * Reads the per-operation zod schemas in `src/bridge/operationSchemas.ts` (the
 * single source of truth) and emits the two copies that used to be maintained
 * by hand:
 *
 *   server/mcp/src/bridge/generated/bridgeRequests.ts
 *     the `BridgeRequest` union `core-types.ts` re-exports.
 *
 *   src/services/mcpBridge/v2/generated/bridgeContracts.ts
 *     the webview's field descriptors, argument types, and unknown-field
 *     posture per operation.
 *
 * Both are COMMITTED, and `--check` re-generates in memory and fails on any
 * difference (`pnpm lint:mcp-contracts`, wired into `check:all`) — so a
 * hand-edit of a generated file is a gate failure, not a surprise later.
 *
 * Output is a pure function of the schemas: operations and fields are emitted
 * in sorted order, never object-key order, so two runs are byte-identical and
 * a reordering of the schema literal produces no diff.
 *
 * Flags (the last three exist so the tests can drive fixtures):
 *   --check                  compare against disk instead of writing
 *   --schemas <path>         schema module to read (default: the real one)
 *   --out-sidecar <path>     where the BridgeRequest union goes
 *   --out-frontend <path>    where the webview contracts go
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIDECAR_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(SIDECAR_ROOT, '../..');

const DEFAULTS = {
  schemas: resolve(SIDECAR_ROOT, 'src/bridge/operationSchemas.ts'),
  outSidecar: resolve(SIDECAR_ROOT, 'src/bridge/generated/bridgeRequests.ts'),
  outFrontend: resolve(REPO_ROOT, 'src/services/mcpBridge/v2/generated/bridgeContracts.ts'),
};

interface ZodDef {
  type: string;
  element?: ZodNode;
  keyType?: ZodNode;
  valueType?: ZodNode;
  innerType?: ZodNode;
  shape?: Record<string, ZodNode>;
}
interface ZodNode {
  _zod?: { def: ZodDef };
  _def?: ZodDef;
}

function defOf(node: ZodNode): ZodDef {
  const def = node?._zod?.def ?? node?._def;
  if (!def || typeof def.type !== 'string') {
    throw new Error('not a zod schema: cannot read its definition');
  }
  return def;
}

/** TypeScript source for one field's type. Fails loudly on an unsupported
 *  construct rather than emitting `any` and calling it a contract. */
export function tsTypeOf(node: ZodNode): string {
  const def = defOf(node);
  switch (def.type) {
    case 'optional':
      return tsTypeOf(def.innerType as ZodNode);
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'unknown':
      return 'unknown';
    case 'array':
      return `${tsTypeOf(def.element as ZodNode)}[]`;
    case 'record':
      return `Record<${tsTypeOf(def.keyType as ZodNode)}, ${tsTypeOf(def.valueType as ZodNode)}>`;
    case 'object': {
      const shape = def.shape ?? {};
      const members = Object.keys(shape)
        .sort()
        .map((name) => {
          const field = shape[name];
          const optional = defOf(field).type === 'optional';
          return `${name}${optional ? '?' : ''}: ${tsTypeOf(field)}`;
        });
      return `{ ${members.join('; ')} }`;
    }
    default:
      throw new Error(`unsupported zod type '${def.type}' in the bridge contract`);
  }
}

/** The runtime shape family a field carries — enough for the webview to do
 *  ONE typed parse instead of a per-field `typeof` chain. */
export const FIELD_KINDS = ['string', 'boolean', 'number', 'array', 'object', 'unknown'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** Runtime kind of a field, after unwrapping optionality. */
export function kindOf(node: ZodNode): FieldKind {
  const def = defOf(node);
  switch (def.type) {
    case 'optional':
      return kindOf(def.innerType as ZodNode);
    case 'string':
    case 'boolean':
    case 'number':
    case 'array':
    case 'unknown':
      return def.type;
    case 'object':
    case 'record':
      return 'object';
    default:
      throw new Error(`unsupported zod type '${def.type}' in the bridge contract`);
  }
}

export interface FieldDescriptor {
  name: string;
  optional: boolean;
  kind: FieldKind;
  tsType: string;
}

/** Sorted field descriptors for one operation schema. */
export function describeFields(schema: ZodNode): FieldDescriptor[] {
  const def = defOf(schema);
  if (def.type !== 'object') throw new Error(`operation schema must be an object, got '${def.type}'`);
  const shape = def.shape ?? {};
  return Object.keys(shape)
    .sort()
    .map((name) => ({
      name,
      optional: defOf(shape[name]).type === 'optional',
      kind: kindOf(shape[name]),
      tsType: tsTypeOf(shape[name]),
    }));
}

const BANNER = (source: string, command: string): string =>
  [
    '/**',
    ' * GENERATED FILE — DO NOT EDIT.',
    ' *',
    ` * Source of truth: ${source}`,
    ` * Regenerate with: ${command}`,
    ' *',
    ' * A hand-edit here fails `pnpm lint:mcp-contracts` (WI-15).',
    ' */',
  ].join('\n');

export interface SchemaModule {
  BRIDGE_OPERATION_SCHEMAS?: Record<string, ZodNode>;
  postureFor?: (operation: string) => string;
}

export interface GeneratedFiles {
  sidecar: string;
  frontend: string;
}

/** Build both files' text. Throws before anything is written when the schema
 *  module is empty or unreadable — a half-written generated file would sail
 *  through the drift check on the next run. */
export function generate(mod: SchemaModule): GeneratedFiles {
  const schemas = mod.BRIDGE_OPERATION_SCHEMAS;
  if (!schemas || typeof schemas !== 'object') {
    throw new Error('schema module exports no BRIDGE_OPERATION_SCHEMAS');
  }
  const operations = Object.keys(schemas).sort();
  if (operations.length === 0) throw new Error('BRIDGE_OPERATION_SCHEMAS declares no operations');
  const posture = mod.postureFor;
  if (typeof posture !== 'function') {
    throw new Error('schema module exports no postureFor()');
  }

  const fields = new Map<string, FieldDescriptor[]>();
  for (const operation of operations) fields.set(operation, describeFields(schemas[operation]));

  return {
    sidecar: renderSidecar(operations, fields),
    frontend: renderFrontend(operations, fields, posture),
  };
}

function renderSidecar(
  operations: string[],
  fields: Map<string, FieldDescriptor[]>
): string {
  const members = operations.map((operation) => {
    const declared = (fields.get(operation) ?? []).map(
      (field) => `      ${field.name}${field.optional ? '?' : ''}: ${field.tsType};`
    );
    return ['  | {', `      type: '${operation}';`, ...declared, '    }'].join('\n');
  });
  return [
    BANNER('src/bridge/operationSchemas.ts', 'pnpm gen:mcp-contracts'),
    '',
    '/** Every command the MCP server can send over the bridge. */',
    'export type BridgeRequest =',
    members.join('\n'),
    '  ;',
    '',
  ].join('\n');
}

function renderFrontend(
  operations: string[],
  fields: Map<string, FieldDescriptor[]>,
  posture: (operation: string) => string
): string {
  const descriptors = operations.map((operation) => {
    const rows = (fields.get(operation) ?? []).map(
      (field) =>
        `    { name: "${field.name}", optional: ${field.optional}, kind: "${field.kind}" },`
    );
    return [`  "${operation}": [`, ...rows, '  ],'].join('\n');
  });
  const postures = operations.map(
    (operation) => `  "${operation}": "${posture(operation)}",`
  );
  const args = operations.map((operation) => {
    const rows = (fields.get(operation) ?? []).map(
      (field) => `    ${field.name}${field.optional ? '?' : ''}: ${field.tsType};`
    );
    return [`  "${operation}": {`, ...rows, '  };'].join('\n');
  });
  return [
    BANNER('server/mcp/src/bridge/operationSchemas.ts', 'pnpm gen:mcp-contracts'),
    '',
    '/** What an operation does with a field its contract does not declare. */',
    'export type UnknownFieldPosture = "reject" | "strip-and-log";',
    '',
    '/** Runtime shape family of a declared field. */',
    `export type BridgeFieldKind = ${FIELD_KINDS.map((kind) => `"${kind}"`).join(' | ')};`,
    '',
    '/** One declared field of one operation payload. */',
    'export interface BridgeFieldDescriptor {',
    '  readonly name: string;',
    '  readonly optional: boolean;',
    '  readonly kind: BridgeFieldKind;',
    '}',
    '',
    '/** Declared fields per operation, sorted by name. */',
    'export const BRIDGE_OPERATION_FIELDS = {',
    descriptors.join('\n'),
    '} as const satisfies Record<string, readonly BridgeFieldDescriptor[]>;',
    '',
    '/** Unknown-field posture per operation (chosen per class; ledger D5). */',
    'export const BRIDGE_OPERATION_POSTURE = {',
    postures.join('\n'),
    '} as const satisfies Record<keyof typeof BRIDGE_OPERATION_FIELDS, UnknownFieldPosture>;',
    '',
    '/** Payload argument types per operation (the `type` discriminant excluded). */',
    'export interface BridgeOperationArgs {',
    args.join('\n'),
    '}',
    '',
  ].join('\n');
}

interface Options {
  check: boolean;
  schemas: string;
  outSidecar: string;
  outFrontend: string;
}

export function parseArgs(argv: string[]): Options {
  const options: Options = {
    check: argv.includes('--check'),
    schemas: DEFAULTS.schemas,
    outSidecar: DEFAULTS.outSidecar,
    outFrontend: DEFAULTS.outFrontend,
  };
  const read = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  options.schemas = read('--schemas') ?? options.schemas;
  options.outSidecar = read('--out-sidecar') ?? options.outSidecar;
  options.outFrontend = read('--out-frontend') ?? options.outFrontend;
  return options;
}

function writeFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

function readOrEmpty(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

export async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  let files: GeneratedFiles;
  try {
    const mod = (await import(pathToFileURL(options.schemas).href)) as SchemaModule;
    files = generate(mod);
  } catch (error) {
    process.stderr.write(
      `gen:mcp-contracts failed — no files written.\n  ${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }

  const targets: [string, string][] = [
    [options.outSidecar, files.sidecar],
    [options.outFrontend, files.frontend],
  ];
  if (!options.check) {
    for (const [path, text] of targets) writeFile(path, text);
    return 0;
  }
  const stale = targets.filter(([path, text]) => readOrEmpty(path) !== text).map(([path]) => path);
  if (stale.length === 0) return 0;
  process.stderr.write(
    `MCP contracts are stale — regenerate with \`pnpm gen:mcp-contracts\`:\n` +
      stale.map((path) => `  ${path}\n`).join('')
  );
  return 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
