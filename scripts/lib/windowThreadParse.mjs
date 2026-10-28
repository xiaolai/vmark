/**
 * Rust source → the `fn` items the window-thread gate reasons about: each
 * function's header, body, parameter list, visibility and command attribute.
 *
 * Purpose: parsing is the half of the gate that has to be right about Rust's
 * lexical structure (literals, nested comments, bodyless declarations,
 * attribute blocks); reachability over the parsed items lives in
 * `windowThreadReach.mjs`.
 *
 * @coordinates-with scripts/check-window-creation-thread.mjs — the gate (CLI) that re-exports this
 * @coordinates-with scripts/lib/windowThreadReach.mjs — reachability over the parsed fns
 * @coordinates-with scripts/lib/rustSource.mjs — the one Rust lexer
 * @module scripts/lib/windowThreadParse
 */
import { rustCode } from "./rustSource.mjs";

/**
 * Rust source → CODE (`rustCode`), with comments AND every literal blanked but
 * offsets and newlines preserved.
 *
 * Load-bearing, not tidiness: the gate script's own header names
 * `WebviewWindowBuilder::new` and `#[tauri::command]` in prose, and so do
 * several Rust module docs. Scanning raw source reads those as code — the
 * mistake `check-ipc-contract.mjs` already records making.
 *
 * The literals matter as much as the comments, and the local lexer this
 * replaced kept them: it copied string CONTENTS through, so a `{` inside an
 * ordinary string moved the brace balance, and it knew nothing of raw strings
 * (`r#"…"#`, whose unescaped quotes flipped it in and out of string mode) or
 * char literals (`'{'`). Either could truncate a function body — hiding every
 * call edge after it — or extend one over the next item.
 * `lib/rustSource.mjs` is the repo's one Rust lexer and already handles all
 * three, plus NESTED block comments.
 */
export const stripComments = (src) => rustCode(src);
/** Literals blanked, comments KEPT — where the opt-out marker legitimately lives. */
const commentsOnly = (src) => rustCode(src, { keepComments: true });

/**
 * Where the signature that starts at `from` ends: `{` when the fn has a BODY,
 * `;` when it is only a declaration (a trait method, an `extern` block item).
 * Depth-tracked over `(`/`[`, because a `;` is ordinary inside an array type
 * (`fn f(x: [u8; 4])`). Returns `[kind, index]`, or `null` at end of input.
 *
 * `indexOf("{")` did none of this: a bodyless `fn a(&self);` in a trait
 * consumed the NEXT item's body, so a phantom function carried someone else's
 * call edges.
 */
function signatureEnd(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && (c === "{" || c === ";")) return [c, i];
  }
  return null;
}

/**
 * The contiguous run of outer attributes immediately before `start`, as text.
 *
 * Walks backward: skip whitespace, then match a complete `#[ … ]` group by
 * counting brackets from its `]`, and repeat. Stops at the first token that is
 * not an attribute, so it cannot reach a previous item's attributes — and it
 * cannot be truncated by an arbitrary window either. `src` is CODE (literals
 * blanked), so a `]` inside a string cannot unbalance the count, and an inner
 * attribute (`#![…]`) is rejected by the `#` test.
 */
function attributeBlock(src, start) {
  let i = start;
  for (;;) {
    while (i > 0 && /\s/.test(src[i - 1])) i -= 1;
    if (src[i - 1] !== "]") break;
    let depth = 0;
    let j = i - 1;
    for (; j >= 0; j -= 1) {
      if (src[j] === "]") depth += 1;
      else if (src[j] === "[") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (j < 1 || src[j - 1] !== "#") break;
    i = j - 1;
  }
  return src.slice(i, start);
}

/**
 * Every `impl` block in CODE as `{ type, trait, open, close }`: the implemented
 * type's own name and trait (`impl<T> Trait for path::Type<T> {` → `Type`,
 * `Trait`) and its brace span.
 * An item inside one is reachable only through that type's path or a receiver,
 * never by a bare call, so reachability needs to know which items they are.
 */
function implBlocks(src) {
  const out = [];
  const IMPL = /\bimpl\b([^{;]*)\{/g;
  let m;
  while ((m = IMPL.exec(src))) {
    let head = m[1].replace(/\bwhere\b[\s\S]*$/, "");
    while (/<[^<>]*>/.test(head)) head = head.replace(/<[^<>]*>/g, "");
    const forAt = head.lastIndexOf(" for ");
    const lastIdent = (t) => t.match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/)?.[1] ?? null;
    const name = lastIdent(forAt >= 0 ? head.slice(forAt + 5) : head);
    const trait = forAt >= 0 ? lastIdent(head.slice(0, forAt)) : null;
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) break; }
    }
    if (name) out.push({ type: name, trait, open, close: i });
  }
  return out;
}

/** The innermost impl block containing `at`, or undefined. */
const enclosing = (impls, at) => impls.filter((b) => b.open < at && at < b.close).sort((a, b) => b.open - a.open)[0];

/** Item header + body for every `fn` in one file, with its command attribute. */
export function parseFns(file, rawSrc) {
  const src = stripComments(rawSrc);
  const commented = commentsOnly(rawSrc);
  // `r#name` is the SAME item as `name` — a raw identifier only escapes a
  // keyword — and the bare class stopped at the `r`, naming the function "r".
  const FN =
    /(?:^|\n)[ \t]*((?:pub(?:\s*\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+(?:r#)?([A-Za-z0-9_]+))/g;
  const impls = implBlocks(src);
  const out = [];
  let m;
  while ((m = FN.exec(src))) {
    const header = m[1];
    const name = m[2];
    const start = m.index + m[0].indexOf(header);
    const sig = signatureEnd(src, start + header.length);
    // A declaration with no body (`fn a(&self);`) defines no call edges, and
    // taking the next `{` in the file would give it another item's.
    if (!sig || sig[0] === ";") continue;
    const open = sig[1];
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) continue;
    const body = src.slice(open, i + 1);
    /** The parameter list, for local-shadowing detection in `callsByName`. */
    const params = src.slice(start + header.length, open);
    // The item's own attribute block, walked BACKWARD over complete `#[…]`
    // groups. It used to be a 600-BYTE slice: a longer contiguous block —
    // several `#[cfg(…)]` lines, or a doc comment blanked to spaces between the
    // attribute and the `fn` — pushed `#[tauri::command]` outside the window,
    // the item stopped being a command, and it left the gate silently.
    // Walking the structure has no window to overflow, and it
    // still cannot reach past the first non-attribute token, which is what kept
    // the small window from binding an unrelated function's attribute.
    const before = attributeBlock(src, start);
    const attr = before.match(/#\[(?:tauri::)?command\b([^\]]*)\]/);
    const vis = header.match(/^pub(?:\s*\(([^)]*)\))?\s+/);
    const { line } = { line: rawSrc.slice(0, start).split("\n").length };
    out.push({
      file,
      name,
      line,
      body,
      params,
      // Comments KEPT, literals blanked: the opt-out marker is a comment, and
      // reading it out of raw source let a string containing
      // `// window-thread-ok: …` suppress a real violation.
      rawBody: commented.slice(open, i + 1),
      isAsync: /\basync\s+fn\b/.test(header),
      isCommand: !!attr,
      attrArgs: attr ? attr[1] : "",
      /** Callable from another module — private fns are file-scoped. */
      crateVisible: !!vis && (vis[1] === undefined || /crate|super|in\s+/.test(vis[1])),
      // The OFFSET is part of the identity: two `fn start` in one file (two
      // impl blocks, a nested fn) shared `file::name`, so marking one reachable
      // marked the other, and a command calling the innocent one was reported.
      id: `${file}::${name}@${start}`,
      /** The innermost `impl` block's type, or null for a free fn. */
      implType: enclosing(impls, start)?.type ?? null,
      /** The trait that `impl` block implements (`impl Trait for Type`), or null. */
      implTrait: enclosing(impls, start)?.trait ?? null,
    });
  }
  return out;
}
