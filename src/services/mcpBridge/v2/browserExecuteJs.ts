/**
 * browserExecuteJs — the wrapper around a user-supplied `execute_js` script.
 *
 * The driver's eval returns a STRING or nothing: WebKit hands the completion
 * handler an NSString for a string result, an NSDictionary/NSArray/NSNumber for
 * anything JSON-like, and nil plus an error for a throw. The Rust side used to
 * render the non-string cases through `-description` and the nil case as the
 * text `<null>` with `success:true` (audit 2026-09-03 E-04), so `return {a:1}`
 * came back as Apple's `{ a = 1; }` and `return document.foo.bar` as a success.
 *
 * The wrapper makes every outcome a JSON string with an explicit `ok` flag:
 * `{ok:true, value}` for a returned value (`undefined` becomes `null`, so the
 * model can tell "nothing" from a transport failure), `{ok:false, error}` for a
 * throw or a value JSON cannot encode (a cycle, a BigInt). `await` is allowed in
 * the body because `callAsyncJavaScript` runs it as an async function body.
 *
 * Deterministic: the same user script always wraps to the same text, so the
 * payload-hash binding (`operation_binds_payload` for `eval`) still holds — an
 * approved script cannot be swapped for another on the retry.
 *
 * @coordinates-with services/mcpBridge/v2/browserPower.ts — the only caller
 * @coordinates-with src-tauri/src/browser/eval_macos.rs — the string-only transport
 * @module services/mcpBridge/v2/browserExecuteJs
 */

export type ExecuteJsOutcome = { ok: true; value: unknown } | { ok: false; error: string };

/** Wrap a user script so its outcome is always a JSON string with an `ok` flag. */
export function wrapExecuteJsScript(script: string): string {
  return (
    "try {\n" +
    `  const __vmarkValue = await (async () => {\n${script}\n  })();\n` +
    // JSON.stringify silently turns functions and symbols into nothing and
    // non-finite numbers into null — a returned function would come back as
    // ok:true/null instead of the documented failure. The replacer refuses them.
    "  var __vmarkRefuse = function (k, v) {\n" +
    "    var t = typeof v;\n" +
    "    if (t === 'function' || t === 'symbol' || t === 'bigint') throw new Error('unserializable value: ' + t + (k ? ' at ' + k : ''));\n" +
    "    if (t === 'number' && !isFinite(v)) throw new Error('unserializable value: non-finite number' + (k ? ' at ' + k : ''));\n" +
    "    return v;\n" +
    "  };\n" +
    "  return JSON.stringify({ ok: true, value: __vmarkValue === undefined ? null : __vmarkValue }, __vmarkRefuse);\n" +
    "} catch (__vmarkError) {\n" +
    "  var __vmarkText;\n" +
    "  try { __vmarkText = String(__vmarkError && __vmarkError.message !== undefined ? __vmarkError.message : __vmarkError); }\n" +
    "  catch (__vmarkInner) { __vmarkText = 'unprintable error'; }\n" +
    "  return JSON.stringify({ ok: false, error: __vmarkText });\n" +
    "}"
  );
}

/** Read the wrapper's JSON back. Anything that is not the wrapper's shape is a
 *  transport-level failure, reported as such rather than as a page value. */
export function unwrapExecuteJsResult(raw: unknown): ExecuteJsOutcome {
  if (typeof raw !== "string") return { ok: false, error: "the driver returned no string result" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: `the driver returned a non-JSON result: ${raw.slice(0, 200)}` };
  }
  if (typeof parsed !== "object" || parsed === null || !("ok" in parsed)) {
    return { ok: false, error: "the driver returned an unexpected result shape" };
  }
  const outcome = parsed as { ok: unknown; value?: unknown; error?: unknown };
  if (outcome.ok === true) return { ok: true, value: outcome.value === undefined ? null : outcome.value };
  return { ok: false, error: typeof outcome.error === "string" ? outcome.error : "unknown script error" };
}
