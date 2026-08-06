/**
 * Strict parsing/validation of `vmark.browser.style` operation arguments —
 * split from browserPower.ts (file-size rule). Everything invalid returns an
 * error string; a partially valid operation is never silently trimmed.
 *
 * @coordinates-with browserPower.ts — sole consumer
 * @module services/mcpBridge/v2/browserStyleOps
 */
import type { StyleOps } from "@/lib/browser/agent/powerScript";

/**
 * Strict parse of the style operations. Returns an error string for anything
 * invalid — a non-string `set` value, an empty/whitespace class token (those
 * throw inside `classList` mid-mutation), or `injectCss` combined with
 * element ops (the generated script would silently skip the element ops).
 */
export function readStyleOps(args: Record<string, unknown>): { ops: StyleOps } | { error: string } {
  const ops: StyleOps = {};
  if (args.set !== undefined) {
    if (typeof args.set !== "object" || args.set === null) return { error: "style 'set' must be an object" };
    ops.set = {};
    for (const [k, v] of Object.entries(args.set as Record<string, unknown>)) {
      if (typeof v !== "string") return { error: `style set['${k}'] must be a string` };
      ops.set[k] = v;
    }
  }
  const readClassList = (key: "addClasses" | "removeClasses"): string | null => {
    if (args[key] === undefined) return null;
    if (!Array.isArray(args[key])) return `style '${key}' must be an array of class names`;
    const list: string[] = [];
    for (const c of args[key] as unknown[]) {
      if (typeof c !== "string" || !c.trim() || /\s/.test(c)) {
        return `style '${key}' entries must be non-empty single class tokens`;
      }
      list.push(c);
    }
    ops[key] = list;
    return null;
  };
  const addErr = readClassList("addClasses");
  if (addErr) return { error: addErr };
  const removeErr = readClassList("removeClasses");
  if (removeErr) return { error: removeErr };
  if (typeof args.injectCss === "string" && args.injectCss.length > 0) ops.injectCss = args.injectCss;

  const hasElementOps =
    (ops.set && Object.keys(ops.set).length > 0) || ops.addClasses?.length || ops.removeClasses?.length;
  if (ops.injectCss && hasElementOps) {
    return { error: "style 'injectCss' cannot be combined with set/addClasses/removeClasses" };
  }
  if (!hasElementOps && !ops.injectCss) {
    return { error: "style requires one of: set, addClasses, removeClasses, or injectCss" };
  }
  return { ops };
}

