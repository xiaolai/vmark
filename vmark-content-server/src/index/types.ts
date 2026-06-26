/**
 * Workspace index types (Phase 2).
 *
 * @module index/types
 */

/** A markdown document discovered in the workspace. */
export interface DocEntry {
  /** Absolute path on disk. */
  absPath: string;
  /** POSIX-style path relative to the workspace root (forward slashes). */
  relPath: string;
  /** Filename without extension, NFC-normalized. */
  basename: string;
}

/** A typed edge in the relationship graph. */
export type EdgeKind = "link" | "wikiLink" | "tag" | "relation";

export interface GraphEdge {
  /** Source doc relPath. */
  from: string;
  /** Target doc relPath, or a tag/relation key when the target is not a doc. */
  to: string;
  kind: EdgeKind;
  /** For `relation` edges: the frontmatter key (e.g. "up", "related"). */
  relationKey?: string;
  /** True when a wiki/link target could not be resolved to a real file. */
  unresolved?: boolean;
}

/** A node in the relationship graph. */
export interface GraphNode {
  /** relPath for docs; `#tag` for tags; relation targets keep their raw key. */
  id: string;
  type: "doc" | "tag";
  label: string;
  /** Frontmatter title when present (docs only). */
  title?: string;
  /** True for graph nodes referenced but with no backing file. */
  unresolved?: boolean;
}

export interface RelationshipGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Extracted references from a single document. */
export interface DocRefs {
  /** `[[target]]` raw values (may contain `#anchor` and were de-aliased). */
  wikiTargets: string[];
  /** Markdown link hrefs that look like local file paths. */
  localLinks: string[];
  /** Inline `#tag` + frontmatter `tags:` values, normalized (no leading #). */
  tags: string[];
  /** Typed relations from frontmatter: key → list of raw targets. */
  relations: Record<string, string[]>;
  /** Frontmatter `title` if present. */
  title?: string;
}
