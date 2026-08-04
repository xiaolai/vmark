// WI-15 — field-level parity for the MCP bridge wire contract.
/**
 * The name-level sibling (`operationManifestParity.test.ts`) proves the same
 * 34 operations exist on every surface. It cannot see INSIDE a payload, and
 * that blind spot is not hypothetical: `src-tauri/src/mcp_bridge/routing.rs`
 * routed on `args.windowId`, a key no shipped tool sends and no contract
 * declares, while `window_routing.rs` told callers to "pass windowId". Nothing
 * failed, because nothing compared field names across the boundary.
 *
 * This test closes that class in both directions:
 *   - a CONSUMER (webview handler or Rust) reading a field the wire contract
 *     does not declare is a born-unreachable branch;
 *   - the wire contract and the generated frontend contract must agree
 *     field-for-field, so the generated copy cannot be hand-edited apart.
 *
 * The producer direction — a contract field no tool ever sends — is proved in
 * the sidecar suite (`server/mcp/__tests__/unit/bridge/operationSends.test.ts`),
 * which can drive the real tool handlers and record what they emit.
 *
 * Ledger: `.claude/tdd-guardian/decisions-20260803.md` D5 (unknown-field
 * posture is per boundary class).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  BRIDGE_OPERATION_FIELDS,
  BRIDGE_OPERATION_POSTURE,
} from "@/services/mcpBridge/v2/generated/bridgeContracts";

const ROOT = process.cwd();

function source(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf8");
}

/** Strip `//` and block comments, leaving string literals intact. */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += ch;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          out += src.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Split `text` on `sep` at bracket depth 0 (ignores quoted separators). */
function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      current += ch;
      i++;
      while (i < text.length && text[i] !== quote) {
        current += text[i];
        i++;
      }
      current += text[i] ?? "";
      i++;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[" || ch === "<") depth++;
    else if (ch === "}" || ch === ")" || ch === "]" || ch === ">") depth--;
    if (ch === sep && depth === 0) {
      parts.push(current);
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  parts.push(current);
  return parts;
}

interface ContractField {
  readonly optional: boolean;
}
type Contract = Map<string, Map<string, ContractField>>;

/**
 * Parse the `BridgeRequest` union out of the sidecar's wire-type module into
 * `operation -> field -> {optional}`.
 *
 * Accepts both spellings the module has carried: the hand-written union of
 * object literals, and the generated form each member of which is still an
 * object literal with a `type: 'vmark.…'` discriminant.
 */
function parseWireContract(src: string): Contract {
  const clean = stripComments(src);
  const anchor = clean.indexOf("export type BridgeRequest =");
  if (anchor < 0) throw new Error("BridgeRequest declaration not found");
  const body = clean.slice(anchor + "export type BridgeRequest =".length);
  const end = splitTopLevel(body, ";")[0];
  const contract: Contract = new Map();
  for (const rawMember of splitTopLevel(end, "|")) {
    const member = rawMember.trim();
    if (!member.startsWith("{")) continue;
    const inner = member.slice(1, member.lastIndexOf("}"));
    let operation: string | null = null;
    const fields = new Map<string, ContractField>();
    for (const rawEntry of splitTopLevel(inner, ";")) {
      const entry = rawEntry.trim();
      if (!entry) continue;
      const match = /^([A-Za-z_$][\w$]*)\s*(\??)\s*:/.exec(entry);
      if (!match) continue;
      const [, name, question] = match;
      if (name === "type") {
        const literal = /'([^']+)'/.exec(entry);
        operation = literal ? literal[1] : null;
        continue;
      }
      fields.set(name, { optional: question === "?" });
    }
    if (!operation) continue;
    contract.set(operation, fields);
  }
  if (contract.size === 0) throw new Error("BridgeRequest union parsed to zero operations");
  return contract;
}

/** Every distinct field name any operation declares. */
function contractFieldNames(contract: Contract): Set<string> {
  const names = new Set<string>();
  for (const fields of contract.values()) for (const name of fields.keys()) names.add(name);
  return names;
}

/** One `args.<key>` read found in a webview handler, with its file. */
interface ArgRead {
  readonly file: string;
  readonly field: string;
}

/**
 * Every field a webview MCP handler reads off a wire-args bag.
 *
 * Scoped to function bodies whose parameter is literally
 * `args: Record<string, unknown>` — the wire-args type. Modules in this
 * directory also use `args` as the name of ordinary typed parameter objects
 * (`recordCheckpoint(args: {resolved, tool, …})`); those are not wire fields,
 * and a whole-file regex would report them as contract drift.
 */
function frontendArgReads(dirRel: string): ArgRead[] {
  const marker = "args: Record<string, unknown>";
  const reads: ArgRead[] = [];
  let scanned = 0;
  for (const file of handlerFiles(dirRel)) {
    const src = stripComments(source(`${dirRel}/${file}`));
    let from = 0;
    for (;;) {
      const at = src.indexOf(marker, from);
      if (at < 0) break;
      from = at + marker.length;
      const body = functionBodyAfter(src, from);
      if (!body) continue;
      scanned++;
      for (const match of body.matchAll(/\bargs\??\.([A-Za-z_$][\w$]*)/g)) {
        reads.push({ file, field: match[1] });
      }
      for (const match of body.matchAll(/\bargs\[\s*"([^"]+)"\s*\]/g)) {
        reads.push({ file, field: match[1] });
      }
    }
  }
  if (scanned === 0) throw new Error(`no wire-args functions found under ${dirRel}`);
  return reads;
}

function handlerFiles(dirRel: string): string[] {
  return readdirSync(join(ROOT, dirRel))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();
}

/** Body text of the function whose parameter list ends after `from`. */
function functionBodyAfter(src: string, from: number): string | null {
  const open = src.indexOf("{", src.indexOf(")", from));
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/** One `args.get("<key>")` read found in the Rust bridge, with its file. */
function rustArgReads(dirRel: string): ArgRead[] {
  const reads: ArgRead[] = [];
  const files = readdirSync(join(ROOT, dirRel))
    .filter((name) => name.endsWith(".rs") && !name.endsWith(".test.rs"))
    .sort();
  for (const file of files) {
    const src = source(`${dirRel}/${file}`);
    for (const match of src.matchAll(/\bargs\s*\.\s*get\(\s*"([^"]+)"\s*\)/g)) {
      reads.push({ file, field: match[1] });
    }
  }
  if (reads.length === 0) throw new Error(`no args.get("…") reads found under ${dirRel}`);
  return reads;
}

const WIRE_TYPES = "server/mcp/src/bridge/generated/bridgeRequests.ts";
const HANDLER_DIR = "src/services/mcpBridge/v2";
const RUST_BRIDGE_DIR = "src-tauri/src/mcp_bridge";

const contract = parseWireContract(source(WIRE_TYPES));
const declared = contractFieldNames(contract);

describe("bridge field parity — consumers may only read declared fields", () => {
  it("every arg key Rust reads off a bridge request is declared by some operation", () => {
    const undeclared = rustArgReads(RUST_BRIDGE_DIR)
      .filter((read) => !declared.has(read.field))
      .map((read) => `${read.file}: args["${read.field}"]`)
      .sort();
    expect(undeclared).toEqual([]);
  });

  it("every arg key a webview handler reads is declared by some operation", () => {
    const undeclared = frontendArgReads(HANDLER_DIR)
      .filter((read) => !declared.has(read.field))
      .map((read) => `${read.file}: args.${read.field}`)
      .sort();
    expect([...new Set(undeclared)]).toEqual([]);
  });
});

describe("bridge field parity — generated contract mirrors the wire contract", () => {
  it("declares the same operations as the sidecar wire types", () => {
    expect(Object.keys(BRIDGE_OPERATION_FIELDS).sort()).toEqual([...contract.keys()].sort());
  });

  it("declares the same field names, with the same optionality, per operation", () => {
    for (const [operation, fields] of contract) {
      const generated = BRIDGE_OPERATION_FIELDS[operation as keyof typeof BRIDGE_OPERATION_FIELDS];
      const expected = [...fields.entries()]
        .map(([name, field]) => `${name}${field.optional ? "?" : ""}`)
        .sort();
      const actual = generated
        .map((field) => `${field.name}${field.optional ? "?" : ""}`)
        .sort();
      expect(actual, `field drift on ${operation}`).toEqual(expected);
    }
  });

  it("assigns every operation an explicit unknown-field posture", () => {
    for (const operation of Object.keys(BRIDGE_OPERATION_FIELDS)) {
      const posture =
        BRIDGE_OPERATION_POSTURE[operation as keyof typeof BRIDGE_OPERATION_POSTURE];
      expect(["reject", "strip-and-log"], `posture for ${operation}`).toContain(posture);
    }
  });
});
