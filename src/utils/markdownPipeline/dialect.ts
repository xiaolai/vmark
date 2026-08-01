/**
 * Purpose: BUILD a unified processor for a parse mode, and wire the injected
 * `<details>` body parser.
 *
 * The plugin table is `dialectDescriptors.ts`. Keeping construction separate is
 * what lets `detailsBlock` receive its body parser without importing the chain
 * that registers it — the cycle the R11 review flagged.
 *
 * @coordinates-with dialectDescriptors.ts — the plugin table
 * @coordinates-with parser/processorFactory.ts — the production caller
 * @coordinates-with plugins/detailsBlock.ts — receives its body parser injected
 * @module utils/markdownPipeline/dialect
 */
import { unified, type Processor } from "unified";
import { setDetailsBodyParser } from "./plugins/detailsBodyParser";
import type { DialectContext, ParseMode } from "./dialectDescriptors";
import { pluginsForMode } from "./dialectQueries";

export type {
  ParseMode,
  DialectContext,
  Membership,
  PluginDescriptor,
  AnalysisFlag,
} from "./dialectDescriptors";
export { PARSE_MODES, DIALECT } from "./dialectDescriptors";
export {
  pluginsForMode,
  unconditionalNames,
  conditionalFlags,
  cacheKeyForMode,
} from "./dialectQueries";

/**
 * Wire the `<details>` body parser at module init.
 *
 * The plugin cannot build this itself without importing the chain that
 * registers it. Doing it here — the module that owns the plugin lists — is
 * what keeps the dependency one-directional. Lazy: the factory runs per parse,
 * after every descriptor is defined.
 */
setDetailsBodyParser(() => buildProcessorForMode("details-body"));

/**
 * Build the processor for `mode`.
 *
 * The single construction site. A descriptor list nothing builds from is just
 * a second list free to drift — which is the defect this module exists to fix,
 * so the factories below delegate here rather than repeating the chain.
 */
export function buildProcessorForMode(
  mode: ParseMode,
  context?: DialectContext
): Processor {
  const processor = unified();
  for (const descriptor of pluginsForMode(mode, context)) {
    if (descriptor.options === undefined) {
      processor.use(descriptor.plugin as never);
    } else {
      processor.use(descriptor.plugin as never, descriptor.options as never);
    }
  }
  return processor;
}
