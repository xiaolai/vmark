/**
 * Purpose: the read operations over `DIALECT` — which plugins a mode runs, and
 * which inputs the set depends on.
 *
 * Split from the table itself so the descriptors stay a flat, reviewable list.
 * Every function here is a pure query: nothing constructs a processor (that is
 * `dialect.ts`) and nothing decides policy (that is the table).
 *
 * @coordinates-with dialectDescriptors.ts — the table these read
 * @coordinates-with dialect.ts — the single construction site
 * @module utils/markdownPipeline/dialectQueries
 */
import {
  DIALECT,
  type AnalysisFlag,
  type DialectContext,
  type ParseMode,
  type PluginDescriptor,
} from "./dialectDescriptors";

/** Descriptors that apply to `mode`, given the content analysis. */
export function pluginsForMode(
  mode: ParseMode,
  context?: DialectContext
): PluginDescriptor[] {
  return DIALECT.filter((d) => {
    const m = d.modes[mode];
    if (m === "never") return false;
    if (m === "always") return true;
    // Conditional: absent analysis means "load it" — the unconditional modes
    // pass none, and a missing flag must never silently DROP a plugin.
    return context ? Boolean(context[m.when]) : true;
  });
}

/**
 * Every flag any descriptor conditions on — what a processor CACHE must key on.
 *
 * `processorFactory` caches built processors, and its own header records the
 * bug that follows from missing one: a processor built for a document needing
 * setext suppressed was reused for one that did not, so the flag looked
 * ignored at random. Deriving the set from the descriptors means adding a
 * conditional plugin cannot silently leave the key behind.
 */
export function conditionalFlags(): AnalysisFlag[] {
  const flags = new Set<AnalysisFlag>();
  for (const descriptor of DIALECT) {
    for (const membership of Object.values(descriptor.modes)) {
      if (typeof membership === "object") flags.add(membership.when);
    }
  }
  return [...flags].sort();
}

/** The plugin names a mode runs unconditionally — used by the drift gate. */
export function unconditionalNames(mode: ParseMode): string[] {
  return DIALECT.filter((d) => d.modes[mode] === "always").map((d) => d.name);
}
