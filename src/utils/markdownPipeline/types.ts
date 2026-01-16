/**
 * Types for the markdown pipeline
 *
 * Re-exports MDAST types and defines custom types for VMark extensions.
 *
 * @module utils/markdownPipeline/types
 */

export interface MarkdownPipelineOptions {
  preserveLineBreaks?: boolean;
}

// Re-export standard MDAST types
export type {
  Root,
  Content,
  Paragraph,
  Heading,
  ThematicBreak,
  Blockquote,
  List,
  ListItem,
  Code,
  Html,
  Text,
  Emphasis,
  Strong,
  Delete,
  InlineCode,
  Link,
  LinkReference,
  Image,
  Table,
  TableRow,
  TableCell,
  Break,
  Definition,
  FootnoteDefinition,
  FootnoteReference,
} from "mdast";

// Re-export math types from mdast-util-math (added by remark-math)
export type { Math, InlineMath } from "mdast-util-math";

// Position type from unist (optional on all AST nodes)
export interface UnistPosition {
  start: { line: number; column: number; offset?: number };
  end: { line: number; column: number; offset?: number };
}

// Frontmatter type from remark-frontmatter
export interface Yaml {
  type: "yaml";
  value: string;
  position?: UnistPosition;
}

// Custom inline types for VMark
export interface Subscript {
  type: "subscript";
  children: PhrasingContent[];
}

export interface Superscript {
  type: "superscript";
  children: PhrasingContent[];
}

export interface Highlight {
  type: "highlight";
  children: PhrasingContent[];
}

export interface Underline {
  type: "underline";
  children: PhrasingContent[];
}

// Wiki link types
export interface WikiLink {
  type: "wikiLink";
  value: string; // The page name
  alias?: string; // Optional display alias
  position?: UnistPosition;
  data?: {
    permalink?: string;
    hProperties?: Record<string, unknown>;
  };
}

export interface WikiEmbed {
  type: "wikiEmbed";
  value: string; // The embedded resource path
  alias?: string;
  position?: UnistPosition;
}

// Alert block types (GitHub-style markdown alerts)
export type AlertType = "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION";

export interface Alert {
  type: "alert";
  alertType: AlertType;
  children: import("mdast").BlockContent[];
  position?: UnistPosition;
}

// Details block types (HTML <details>/<summary>)
export interface Details {
  type: "details";
  open?: boolean;
  summary?: string;
  children: import("mdast").BlockContent[];
  position?: UnistPosition;
}

// Union type for all phrasing (inline) content
// Note: mdast PhrasingContent already includes InlineMath via mdast-util-math augmentation
export type PhrasingContent =
  | import("mdast").PhrasingContent
  | Subscript
  | Superscript
  | Highlight
  | Underline
  | WikiLink
  | WikiEmbed;

// Union type for all block content
// Note: mdast BlockContent already includes Math via mdast-util-math augmentation
export type BlockContent =
  | import("mdast").BlockContent
  | Yaml
  | WikiEmbed
  | Alert
  | Details;

// Augment MDAST module for custom VMark types
// Note: math and inlineMath are already augmented by mdast-util-math
declare module "mdast" {
  interface RootContentMap {
    yaml: Yaml;
    wikiEmbed: WikiEmbed;
    alert: Alert;
    details: Details;
  }

  interface PhrasingContentMap {
    subscript: Subscript;
    superscript: Superscript;
    highlight: Highlight;
    underline: Underline;
    wikiLink: WikiLink;
    wikiEmbed: WikiEmbed;
  }
}
