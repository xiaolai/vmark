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
 * `{ok:true, value}` for a returned value, `{ok:false, error}` for a throw or a
 * value JSON cannot encode (a cycle, a function, a symbol, a BigInt, a non-finite
 * number — refused BY NAME, wherever it sits, where `JSON.stringify` would have
 * dropped it or emitted `null`). `await` is allowed in the body because
 * `callAsyncJavaScript` runs it as an async function body.
 *
 * `undefined` is the one value JSON lacks that is ENCODED rather than refused, as
 * `null` at every depth (round 3, #47): the top level so the model can tell
 * "nothing" from a transport failure, and a nested property or array slot so the
 * key survives — dropping it (the stringify default) changes the object's shape
 * behind the model's back, and refusing it would fail the most common value in JS,
 * a missing property read.
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
    // JSON.stringify silently turns functions and symbols into nothing, non-finite
    // numbers into null and a nested undefined into a missing key. The replacer
    // refuses the first three by name and encodes undefined as null at every depth.
    // The user value is serialized on its own (root key "") and spliced into the
    // envelope afterwards, so a top-level refusal is not blamed on the wrapper's
    // own `value` key.
    "  var __vmarkRefuse = function (k, v) {\n" +
    "    var t = typeof v;\n" +
    "    if (t === 'undefined') return null;\n" +
    "    if (t === 'function' || t === 'symbol' || t === 'bigint') throw new Error('unserializable value: ' + t + (k ? ' at ' + k : ''));\n" +
    "    if (t === 'number' && !isFinite(v)) throw new Error('unserializable value: non-finite number' + (k ? ' at ' + k : ''));\n" +
    "    return v;\n" +
    "  };\n" +
    "  return '{\"ok\":true,\"value\":' + JSON.stringify(__vmarkValue, __vmarkRefuse) + '}';\n" +
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
