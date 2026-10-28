---
name: tiptap-dev
description: Tiptap and ProseMirror work in VMark's WYSIWYG editor - custom nodes, marks and extensions, input and paste rules, the commands API, node views, selection handling and node traversal, and when to drop to raw ProseMirror. Use when changing editor commands, plugins or extensions.
---

# Tiptap Development (VMark)

VMark's WYSIWYG editor is Tiptap on ProseMirror. This skill covers both the
general Tiptap API and where VMark uses Tiptap versus raw ProseMirror.

## Tiptap API or ProseMirror?

**Prefer the Tiptap API for:** format commands (bold, italic, underline…), block
type changes, list operations, table operations through the table extension,
content insertion and replacement, and state queries (`isActive`,
`getAttributes`). Use `editor.commands.x()` for one operation and
`editor.chain().focus().x().run()` when focus is needed or operations chain.

**Use ProseMirror directly for:**
- The markdown conversion layer (`src/utils/markdownPipeline/` —
  `mdastToProseMirror.ts` and the `mdast*Converters.ts` family)
- Multi-cursor selection subclassing (`src/plugins/shared/MultiSelection.ts`)
- Custom node views, low-level transactions, schema-level operations

**Respect block boundaries.** Never flatten with `doc.textContent` when a
position or block matters; resolve the position and use the `$pos` helpers
(`$pos.parent`, `$pos.before(depth)`, `$pos.after(depth)`).
`references/vmark-patterns.md` has the `$pos` reference.

VMark examples to copy from: `src/plugins/toolbarActions/wysiwygAdapter*.ts`
(block, list, code-block and CJK operations), `src/plugins/editorPlugins.tiptap.ts`
(state checks), `src/components/Editor/TiptapEditor.tsx` (content setup).
Plugins must not import app stores (`lint:store-coupling`; rule 00).

## When to Use This Skill

- Creating custom nodes, marks, or extensions for Tiptap
- Implementing input rules or paste rules
- Working with the Tiptap commands API
- Building React integrations with useEditor
- Extending existing extensions
- Creating custom node views
- Understanding the schema and content model

## Reference Files

| File | Description |
|------|-------------|
| `references/extensions.md` | Extension types (Node, Mark, Extension), creation patterns |
| `references/commands-and-api.md` | Commands API, editor API, chaining |
| `references/input-paste-rules.md` | Input rules and paste rules |
| `references/react-integration.md` | React-specific hooks and components |
| `references/schema.md` | Schema properties, content patterns |
| `references/examples.md` | Complete working examples |
| `references/vmark-patterns.md` | Commands, state queries, `$pos` traversal and transactions, as VMark uses them |

## Quick Reference

### Extension Types

```typescript
// Functionality extension (no schema)
Extension.create({ name: 'myExtension', addKeyboardShortcuts() { ... } })

// Node extension (block content)
Node.create({ name: 'myNode', group: 'block', content: 'inline*' })

// Mark extension (inline formatting)
Mark.create({ name: 'myMark', parseHTML() { ... }, renderHTML() { ... } })
```

### Command Chaining

```typescript
editor.chain().focus().toggleBold().run()
editor.can().chain().focus().toggleBold().run() // dry run
```

### React Integration

```typescript
const editor = useEditor({
  extensions: [StarterKit],
  content: '<p>Hello</p>',
  immediatelyRender: false, // for SSR
})
```

## Core Concepts

1. **Headless Architecture**: Tiptap provides logic, you control rendering
2. **Extension-Based**: Everything is an extension (nodes, marks, functionality)
3. **ProseMirror Foundation**: Built on ProseMirror, full access to its APIs
4. **Schema-Driven**: Content model defined by node/mark schemas
5. **Command Pattern**: All operations via chainable commands
