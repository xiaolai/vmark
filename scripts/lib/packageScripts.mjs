/**
 * Purpose: expand a package.json script transitively, so a "is this gate wired
 *   into check:all?" assertion survives `check:all` being composed of
 *   sub-scripts.
 *
 * `check:all` used to be one flat 31-step `&&` chain, and several gate tests
 * asserted `pkg.scripts["check:all"]).toContain("lint:their-gate")`. When CI
 * needed the chain split into parallel groups (`check:static`, `check:servers`,
 * `check:build`) those literal assertions broke even though every gate was
 * still chained in — the guard was pinned to the SHAPE of the script rather
 * than to the property it cares about.
 *
 * Expanding transitively pins the property: "running `pnpm check:all`
 * eventually runs this gate", regardless of how the chain is grouped.
 *
 * @module scripts/lib/packageScripts
 */

/**
 * The script NAMES that `pnpm <name>` transitively invokes, in run order.
 *
 * Names, not expanded command lines: a caller asking "is `lint:mock-boundaries`
 * wired in?" wants the script it can run, and expanding that leaf to
 * `node scripts/check-mock-boundaries.mjs` would answer a different question
 * (and make the assertion restate the command, so renaming the script silently
 * still "passes").
 *
 * A step counts as a reference only when it is a bare `pnpm <script-name>`;
 * anything with arguments or flags is a real command, not a composition.
 * Cycles are broken by tracking visited names, so a malformed package.json
 * cannot hang the caller.
 */
export function invokedScripts(scripts, name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const body = scripts?.[name];
  if (typeof body !== "string") return [];

  const out = [];
  for (const step of body.split("&&")) {
    const token = step.trim();
    const ref = token.startsWith("pnpm ") ? token.slice("pnpm ".length).trim() : null;
    if (ref && !ref.includes(" ") && typeof scripts?.[ref] === "string") {
      out.push(ref, ...invokedScripts(scripts, ref, seen));
    }
  }
  return out;
}
