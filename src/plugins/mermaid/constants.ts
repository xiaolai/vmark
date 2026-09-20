/**
 * Mermaid Plugin Constants
 *
 * Shared constants for mermaid diagram functionality.
 */

/**
 * Default mermaid diagram template used when inserting new diagrams.
 */
export const DEFAULT_MERMAID_DIAGRAM = `graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Do something]
    B -->|No| D[Do another thing]
    C --> E[End]
    D --> E`;

/**
 * The two defaults Mermaid 12 changed, pinned back to what Mermaid 11 drew.
 *
 * v12 made ELK the default layout engine (was dagre) and `neo` the default
 * look (was classic). Both re-lay-out and re-colour EVERY diagram already
 * written in a user's documents — a dependency bump is the wrong moment for
 * that, and it is not something a user can opt out of once it ships.
 *
 * Spread into BOTH of `plugin.ts`'s `initialize()` calls. The export path is
 * a separate initialize, so pinning only the live one would export diagrams
 * that do not match what the editor shows; `plugin.test.ts` asserts both.
 *
 * Adopting v12's new look is a deliberate visual decision, not a side effect
 * of upgrading — this is the one place to change it.
 */
export const MERMAID_V11_RENDERING = { layout: "dagre", look: "classic" } as const;
