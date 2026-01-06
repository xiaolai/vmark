export const tiptapToolbarIcons = {
  bold: `<svg viewBox="0 0 24 24"><path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/></svg>`,
  italic: `<svg viewBox="0 0 24 24"><line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/></svg>`,
  strikethrough: `<svg viewBox="0 0 24 24"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/></svg>`,
  code: `<svg viewBox="0 0 24 24"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>`,
  link: `<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  h1: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/></svg>`,
  h2: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/></svg>`,
  h3: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/></svg>`,
  h4: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 10v4h4"/><path d="M21 10v8"/></svg>`,
  h5: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 18h4c0-3-4-4-4-7h4"/></svg>`,
  h6: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><circle cx="19" cy="16" r="2"/><path d="M20 10c-2 0-3 1.5-3 4"/></svg>`,
  paragraph: `<svg viewBox="0 0 24 24"><path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/></svg>`,
  chevronDown: `<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>`,
  indent: `<svg viewBox="0 0 24 24"><path d="M12 6h9"/><path d="M12 12h9"/><path d="M12 18h9"/><path d="m3 8 4 4-4 4"/></svg>`,
  outdent: `<svg viewBox="0 0 24 24"><path d="M12 6h9"/><path d="M12 12h9"/><path d="M12 18h9"/><path d="m7 8-4 4 4 4"/></svg>`,
  bulletList: `<svg viewBox="0 0 24 24"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><circle cx="4" cy="6" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="18" r="1.5"/></svg>`,
  orderedList: `<svg viewBox="0 0 24 24"><line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>`,
  removeList: `<svg viewBox="0 0 24 24"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/><line x1="2" y1="2" x2="22" y2="22" stroke-width="2"/></svg>`,
  nestQuote: `<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/><path d="M3 21c3 0 7-1 7-8V5"/></svg>`,
  unnestQuote: `<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/><path d="M21 21c-3 0-7-1-7-8V5"/></svg>`,
  removeQuote: `<svg viewBox="0 0 24 24"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4"/><line x1="2" y1="2" x2="22" y2="22" stroke-width="2"/></svg>`,
} as const;

export const TIPTAP_FORMAT_BUTTONS = [
  { icon: tiptapToolbarIcons.bold, title: "Bold", markType: "bold" },
  { icon: tiptapToolbarIcons.italic, title: "Italic", markType: "italic" },
  { icon: tiptapToolbarIcons.strikethrough, title: "Strikethrough", markType: "strike" },
  { icon: tiptapToolbarIcons.link, title: "Link", markType: "link" },
  { icon: tiptapToolbarIcons.code, title: "Inline Code", markType: "code" },
] as const;

export const TIPTAP_HEADING_BUTTONS = [
  { icon: tiptapToolbarIcons.h1, title: "Heading 1", level: 1 },
  { icon: tiptapToolbarIcons.h2, title: "Heading 2", level: 2 },
  { icon: tiptapToolbarIcons.h3, title: "Heading 3", level: 3 },
  { icon: tiptapToolbarIcons.h4, title: "Heading 4", level: 4 },
  { icon: tiptapToolbarIcons.h5, title: "Heading 5", level: 5 },
  { icon: tiptapToolbarIcons.h6, title: "Heading 6", level: 6 },
  { icon: tiptapToolbarIcons.paragraph, title: "Paragraph", level: 0 },
] as const;

