/**
 * Shared SVG Icons
 *
 * Lucide-style icons (24x24 viewBox, stroke-based) used across
 * both Milkdown and CodeMirror editors.
 */

import type { ReactNode } from "react";

export const icons = {
  // Text/Block icons
  paragraph: `<svg viewBox="0 0 24 24"><path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 1 0 0 9H13"/></svg>`,
  heading1: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/></svg>`,
  heading2: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/></svg>`,
  heading3: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/></svg>`,
  heading4: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 10v4h4"/><path d="M21 10v8"/></svg>`,
  heading5: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 18h4c0-3-4-4-4-7h4"/></svg>`,
  heading6: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><circle cx="19" cy="16" r="2"/><path d="M20 10c-2 0-3 1.5-3 4"/></svg>`,

  // Inline format icons
  bold: `<svg viewBox="0 0 24 24"><path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/></svg>`,
  italic: `<svg viewBox="0 0 24 24"><line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/></svg>`,
  strikethrough: `<svg viewBox="0 0 24 24"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/></svg>`,
  inlineCode: `<svg viewBox="0 0 24 24"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>`,
  highlight: `<svg viewBox="0 0 24 24"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>`,
  subscript: `<svg viewBox="0 0 24 24"><path d="m4 5 8 8"/><path d="m12 5-8 8"/><path d="M20 19h-4c0-1.5.44-2 1.5-2.5S20 15.33 20 14c0-.47-.17-.93-.48-1.29a2.11 2.11 0 0 0-2.62-.44c-.42.24-.74.62-.9 1.07"/></svg>`,
  superscript: `<svg viewBox="0 0 24 24"><path d="m4 19 8-8"/><path d="m12 19-8-8"/><path d="M20 12h-4c0-1.5.442-2 1.5-2.5S20 8.334 20 7c0-.472-.167-.933-.48-1.29a2.105 2.105 0 0 0-2.617-.436c-.42.239-.738.614-.903 1.06"/></svg>`,
  link: `<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  image: `<svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
  footnote: `<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M12 4h9"/><path d="M4 12h9"/><path d="M4 7V4h3"/><path d="M4 20v-3h3"/></svg>`,
  heading: `<svg viewBox="0 0 24 24"><path d="M6 12h12"/><path d="M6 20V4"/><path d="M18 20V4"/></svg>`,
  blockquote: `<svg viewBox="0 0 24 24"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v4"/></svg>`,

  // Table icons
  table: `<svg viewBox="0 0 24 24"><path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>`,
  rowAbove: `<svg viewBox="0 0 24 24"><path d="M5 3h14"/><path d="m12 10-4-4 4-4"/><path d="M12 6v8"/><rect width="20" height="8" x="2" y="14" rx="2"/></svg>`,
  rowBelow: `<svg viewBox="0 0 24 24"><path d="M5 21h14"/><path d="m12 14 4 4-4 4"/><path d="M12 18v-8"/><rect width="20" height="8" x="2" y="2" rx="2"/></svg>`,
  colLeft: `<svg viewBox="0 0 24 24"><path d="M3 5v14"/><path d="m10 12-4-4 4-4"/><path d="M6 12h8"/><rect width="8" height="20" x="14" y="2" rx="2"/></svg>`,
  colRight: `<svg viewBox="0 0 24 24"><path d="M21 5v14"/><path d="m14 12 4-4-4-4"/><path d="M18 12h-8"/><rect width="8" height="20" x="2" y="2" rx="2"/></svg>`,
  deleteRow: `<svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><rect x="3" y="6" width="18" height="12" rx="2" fill="none"/></svg>`,
  deleteCol: `<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><rect x="6" y="3" width="12" height="18" rx="2" fill="none"/></svg>`,
  deleteTable: `<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,

  // Alignment icons (column)
  alignLeft: `<svg viewBox="0 0 24 24"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>`,
  alignCenter: `<svg viewBox="0 0 24 24"><line x1="18" y1="10" x2="6" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="18" y1="18" x2="6" y2="18"/></svg>`,
  alignRight: `<svg viewBox="0 0 24 24"><line x1="21" y1="10" x2="7" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="7" y2="18"/></svg>`,
  // Alignment icons (all columns - with table outline)
  alignAllLeft: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none"/><line x1="7" y1="8" x2="14" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="14" y2="16"/></svg>`,
  alignAllCenter: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="8" y1="16" x2="16" y2="16"/></svg>`,
  alignAllRight: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none"/><line x1="10" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="16" x2="17" y2="16"/></svg>`,
  // Format table (space-padded alignment)
  formatTable: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>`,

  // UI icons
  chevronDown: `<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>`,
};

/**
 * Create a React component from an SVG string.
 * Applies consistent styling for toolbar buttons.
 */
export function createIcon(svgString: string, size = 16): ReactNode {
  return (
    <span
      className="icon"
      style={{ width: size, height: size, display: "flex" }}
      dangerouslySetInnerHTML={{ __html: svgString }}
    />
  );
}
