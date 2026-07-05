/**
 * Graphviz Plugin Constants
 *
 * Shared constants for Graphviz diagram functionality.
 */

/**
 * Default Graphviz DOT template used when inserting new diagrams.
 */
export const DEFAULT_GRAPHVIZ_DIAGRAM = `digraph G {
    rankdir = LR
    start -> process -> decision
    decision -> done [label = "yes"]
    decision -> process [label = "no", style = dashed]
}`;
