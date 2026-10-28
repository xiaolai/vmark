# Tiptap API Patterns Reference

## Command Patterns

### Direct Commands
Use when you don't need to chain or maintain focus:

```typescript
editor.commands.setContent(doc, { emitUpdate: false })
editor.commands.insertContent(content)
editor.commands.insertContentAt(position, content)
editor.commands.setTextSelection(position)
editor.commands.setParagraph()
editor.commands.setHeading({ level: 2 })
editor.commands.setCodeBlock({ language: "typescript" })
editor.commands.setBlockquote()
editor.commands.setHorizontalRule()
editor.commands.toggleBold()
editor.commands.toggleItalic()
editor.commands.toggleBulletList()
editor.commands.toggleOrderedList()
editor.commands.toggleHeading({ level: 2 })
editor.commands.toggleCodeBlock()
editor.commands.sinkListItem("listItem")
editor.commands.liftListItem("listItem")
editor.commands.undo()
editor.commands.redo()
```

### Chained Commands
Use when you need focus or multiple operations:

```typescript
// Format toggles with focus
editor.chain().focus().toggleBold().run()
editor.chain().focus().toggleMark("underline").run()
editor.chain().focus().toggleMark("highlight").run()

// Block type changes with focus
editor.chain().focus().setHeading({ level: 2 }).run()
editor.chain().focus().setParagraph().run()
editor.chain().focus().setCodeBlock().run()
editor.chain().focus().setHorizontalRule().run()

// Table operations
editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()

// Attribute updates
editor.chain().focus().updateAttributes("codeBlock", { language: "python" }).run()
```

## State Queries

### Active State
```typescript
// Check block type
editor.isActive("blockquote")
editor.isActive("heading")
editor.isActive("heading", { level: 2 })
editor.isActive("codeBlock")
editor.isActive("bulletList")
editor.isActive("orderedList")

// Check marks
editor.isActive("bold")
editor.isActive("italic")
editor.isActive("link")
```

### Get Attributes
```typescript
editor.getAttributes("heading")  // { level: 2 }
editor.getAttributes("link")     // { href: "...", target: "..." }
editor.getAttributes("codeBlock") // { language: "typescript" }
```

## Selection Access

```typescript
const { from, to } = editor.state.selection
const { $from, $to } = editor.state.selection
const { anchor, head } = editor.state.selection

// Check selection type
editor.state.selection.empty  // cursor (no selection)
```

## Node Traversal with $pos

The `$pos` object (ResolvedPos) provides powerful node traversal. Get it via:

```typescript
const $pos = editor.state.doc.resolve(position)
// or
const { $from, $to } = editor.state.selection
```

### $pos Properties
```typescript
$pos.pos        // Absolute position
$pos.depth      // Nesting depth (0 = doc root)
$pos.parent     // Immediate parent node
$pos.parentOffset // Offset within parent
$pos.doc        // Root document
```

### Node Access by Depth
```typescript
$pos.node()         // Same as $pos.parent
$pos.node(0)        // Document root
$pos.node(1)        // First-level block (paragraph, heading, etc.)
$pos.node($pos.depth) // Current parent (same as $pos.parent)
$pos.node($pos.depth - 1) // Grandparent
```

### Position Helpers
```typescript
$pos.before()       // Position before parent
$pos.after()        // Position after parent
$pos.before(depth)  // Position before node at depth
$pos.after(depth)   // Position after node at depth
$pos.start()        // Start of parent content
$pos.end()          // End of parent content
$pos.start(depth)   // Start of node at depth
$pos.end(depth)     // End of node at depth
```

### Index Access
```typescript
$pos.index()        // Child index within parent
$pos.index(depth)   // Child index at specific depth
$pos.indexAfter()   // Index after this position
```

### Block Boundary Detection
```typescript
// Get current block boundaries
const $pos = doc.resolve(cursorPos)
const blockStart = $pos.before($pos.depth)
const blockEnd = $pos.after($pos.depth)
const blockNode = $pos.parent

// Get block text content
const blockText = blockNode.textContent
```

### Finding Enclosing Nodes
```typescript
// Walk up to find specific node type
function findAncestor($pos: ResolvedPos, type: string): Node | null {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d)
    if (node.type.name === type) return node
  }
  return null
}
```

## Document Traversal

### Iterate All Nodes
```typescript
editor.state.doc.descendants((node, pos) => {
  if (node.type.name === "heading") {
    console.log(node.attrs.level, node.textContent)
  }
  return true // continue traversal
})
```

### Node Between Positions
```typescript
editor.state.doc.nodesBetween(from, to, (node, pos) => {
  // Process nodes in range
})
```

## Transaction-Based Updates

For complex updates, use transactions:

```typescript
const { tr } = editor.state
tr.setNodeMarkup(pos, null, { ...newAttrs })
editor.view.dispatch(tr)
```

## Common Patterns in VMark

### Toggle with Fallback
```typescript
if (editor.isActive("blockquote")) {
  editor.commands.lift("blockquote")
} else {
  editor.commands.setBlockquote()
}
```

### Heading Level Cycling
```typescript
const currentLevel = editor.getAttributes("heading").level
if (currentLevel === 6) {
  editor.chain().focus().setParagraph().run()
} else {
  editor.chain().focus().setHeading({ level: currentLevel + 1 }).run()
}
```
