// @vitest-environment node
// WI-AL3.2 — the command family is the caller (R36): no file under src/services/mcpBridge imports the person's comment client or create, directly or by a relative path, and none names a comment_user_ command, so an agent's request can never be recorded as the person's
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../../../..");
const BRIDGE = join(ROOT, "src/services/mcpBridge");
const USER_MODULES = ["src/services/agentJournal/comments/commentClient", "src/services/agentJournal/comments/commentCreate"];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every module specifier in `code`: static and dynamic imports, re-exports, `vi.mock`. */
function specifiers(code: string): string[] {
  const found: string[] = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bvi\.mock\(\s*)["']([^"']+)["']/g;
  for (let m = pattern.exec(code); m; m = pattern.exec(code)) found.push(m[1]);
  return found;
}

/** `spec` imported from `file`, as a path under the repository without its extension. */
function target(file: string, spec: string): string {
  const path = spec.startsWith("@/") ? join(ROOT, "src", spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(file), spec) : spec;
  return relative(ROOT, path).replace(/\.tsx?$/, "").replace(/\/index$/, "");
}

/** The bridge files that reach the person's comment client. */
function violations(files: readonly { path: string; code: string }[]): string[] {
  return files.flatMap(({ path, code }) => [
    ...specifiers(code)
      .filter((spec) => USER_MODULES.includes(target(path, spec)))
      .map((spec) => `${relative(ROOT, path)} imports ${spec}`),
    ...(/["'`]comment_user_/.test(code) ? [`${relative(ROOT, path)} names a comment_user_ command`] : []),
  ]);
}

describe("the comment caller boundary", () => {
  it("no MCP bridge file reaches the person's comment client", () => {
    const files = sources(BRIDGE).map((path) => ({ path, code: readFileSync(path, "utf8") }));
    expect(files.length).toBeGreaterThan(20);
    expect(violations(files)).toEqual([]);
  });

  it.each([
    ["an alias import", 'import { replyToComment } from "@/services/agentJournal/comments/commentClient";'],
    ["a relative import", 'import { createComment } from "../../../agentJournal/comments/commentCreate";'],
    ["a dynamic import", 'const m = await import("@/services/agentJournal/comments/commentClient.ts");'],
    ["a re-export", 'export * from "@/services/agentJournal/comments/commentClient";'],
    ["a command literal", 'await invoke("comment_user_resolve", args);'],
  ])("catches %s", (_, code) => {
    expect(violations([{ path: join(BRIDGE, "v2/handlers/x.ts"), code }])).toHaveLength(1);
  });

  it("allows the decoders the agent family will share", () => {
    expect(violations([{ path: join(BRIDGE, "v2/x.ts"), code: 'import { parseCommentList } from "@/services/agentJournal/comments/commentReplies";' }])).toEqual([]);
  });
});
