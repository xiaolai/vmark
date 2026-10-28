# Webview Testing

## Overview

The `webview_*` tools interact with the DOM inside a Tauri app's webview. These tools provide full control over element discovery, interaction, and verification.

## Element Discovery

### Find Elements

```typescript
// Find by CSS selector
webview_find_element({ selector: '.editor-content' })

// Find by XPath
webview_find_element({
  selector: '//div[@class="editor"]//p',
  strategy: 'xpath'
})

// Find by text content
webview_find_element({
  selector: 'Save Document',
  strategy: 'text'
})
```

### Element Response

```json
{
  "found": true,
  "count": 1,
  "elements": [
    {
      "uid": "element-abc123",
      "tagName": "button",
      "className": "save-button",
      "text": "Save",
      "rect": { "x": 100, "y": 50, "width": 80, "height": 32 }
    }
  ]
}
```

## Screenshots

### Full Viewport

```typescript
webview_screenshot()
```

### Specific Element

```typescript
webview_screenshot({ uid: 'element-abc123' })
```

### Save to File

```typescript
webview_screenshot({
  filePath: 'dev-docs/archive/test-screenshots/screenshot.png',
  format: 'png'
})

// JPEG with quality
webview_screenshot({
  filePath: 'dev-docs/archive/test-screenshots/screenshot.jpg',
  format: 'jpeg',
  quality: 80
})
```

## Interactions

### Click Actions

```typescript
// Single click
webview_interact({ action: 'click', selector: '.button' })

// Double click
webview_interact({ action: 'double-click', selector: '.item' })

// Long press (touch)
webview_interact({
  action: 'long-press',
  selector: '.context-trigger',
  duration: 500  // ms
})

// Click by coordinates
webview_interact({ action: 'click', x: 150, y: 200 })
```

### Focus

```typescript
webview_interact({ action: 'focus', selector: 'input.search' })
```

### Scrolling

```typescript
// Scroll element vertically
webview_interact({
  action: 'scroll',
  selector: '.scrollable-content',
  scrollY: 500  // pixels down
})

// Scroll horizontally
webview_interact({
  action: 'scroll',
  selector: '.horizontal-list',
  scrollX: 200  // pixels right
})

// Scroll both directions
webview_interact({
  action: 'scroll',
  selector: '.canvas',
  scrollX: 100,
  scrollY: 200
})
```

### Swipe Gestures

```typescript
// Swipe left
webview_interact({
  action: 'swipe',
  fromX: 300, fromY: 400,
  toX: 100, toY: 400,
  duration: 300
})

// Swipe up (scroll down on mobile)
webview_interact({
  action: 'swipe',
  fromX: 200, fromY: 500,
  toX: 200, toY: 200,
  duration: 250
})
```

## Keyboard Input

### Type Text

```typescript
// Type into specific element
webview_keyboard({
  action: 'type',
  selector: 'textarea.content',
  text: 'Hello, World!'
})

// Type multiline
webview_keyboard({
  action: 'type',
  selector: '.editor',
  text: '# Title\n\nParagraph text here.'
})
```

### Key Press

```typescript
// Single key
webview_keyboard({ action: 'press', key: 'Enter' })
webview_keyboard({ action: 'press', key: 'Escape' })
webview_keyboard({ action: 'press', key: 'Tab' })

// Arrow keys
webview_keyboard({ action: 'press', key: 'ArrowDown' })
webview_keyboard({ action: 'press', key: 'ArrowRight' })
```

### Key Combinations

```typescript
// Ctrl+S (Save)
webview_keyboard({
  action: 'press',
  key: 's',
  modifiers: ['Control']
})

// Cmd+Shift+Z (Redo on macOS)
webview_keyboard({
  action: 'press',
  key: 'z',
  modifiers: ['Meta', 'Shift']
})

// Ctrl+Alt+Delete
webview_keyboard({
  action: 'press',
  key: 'Delete',
  modifiers: ['Control', 'Alt']
})
```

### Key Down/Up (Hold)

```typescript
// Hold Shift while clicking
webview_keyboard({ action: 'down', key: 'Shift' })
webview_interact({ action: 'click', selector: '.item:last-child' })
webview_keyboard({ action: 'up', key: 'Shift' })
```

## Waiting

### Wait for Element

```typescript
// Wait for element to appear
webview_wait_for({
  type: 'selector',
  value: '.loading-complete',
  timeout: 10000  // 10 seconds
})
```

### Wait for Text

```typescript
// Wait for specific text
webview_wait_for({
  type: 'text',
  value: 'Operation successful',
  timeout: 5000
})
```

### Wait for IPC Event

```typescript
// Wait for Tauri event
webview_wait_for({
  type: 'ipc-event',
  value: 'document-saved',
  timeout: 5000
})
```

## CSS Styles

### Get Computed Styles

```typescript
// All computed styles
webview_execute_js({ script: `(() => { const s = getComputedStyle(document.querySelector('.editor')); return Object.fromEntries([...s].map(p => [p, s.getPropertyValue(p)])); })()` })

// Specific properties
webview_execute_js({ script: `(() => { const s = getComputedStyle(document.querySelector('.editor')); return Object.fromEntries(["font-size", "font-family", "color", "background-color"].map(p => [p, s.getPropertyValue(p)])); })()` })
```

### Multiple Elements

```typescript
// Get styles from all matching elements
webview_execute_js({ script: `[...document.querySelectorAll('.toolbar-button')].map(el => { const s = getComputedStyle(el); return Object.fromEntries(["opacity", "background-color"].map(p => [p, s.getPropertyValue(p)])); })` })
```

## JavaScript Execution

### Basic Execution

```typescript
// Execute without return value
webview_execute_js({
  script: 'console.log("Test running")'
})
```

### Return Values (IIFE Required)

```typescript
// CORRECT: Use IIFE for return values
webview_execute_js({
  script: '(() => { return document.title; })()'
})

// WRONG: This returns undefined
webview_execute_js({
  script: 'return document.title;'  // Won't work!
})
```

### Complex Operations

```typescript
// Get element count
webview_execute_js({
  script: '(() => { return document.querySelectorAll(".item").length; })()'
})

// Check state
webview_execute_js({
  script: `(() => {
    const editor = document.querySelector('.editor');
    return {
      hasContent: editor.textContent.length > 0,
      isDirty: editor.dataset.dirty === 'true',
      wordCount: editor.textContent.split(/\\s+/).length
    };
  })()`
})

// Access Tauri API
webview_execute_js({
  script: '(() => { return window.__TAURI__.app.getName(); })()'
})
```

## Testing Patterns

### Pattern: Form Fill and Submit

```typescript
// 1. Fill form fields
webview_keyboard({
  action: 'type',
  selector: '#username',
  text: 'testuser'
})

webview_keyboard({
  action: 'type',
  selector: '#password',
  text: 'testpass123'
})

// 2. Submit form
webview_interact({ action: 'click', selector: 'button[type="submit"]' })

// 3. Wait for result
webview_wait_for({ type: 'selector', value: '.dashboard', timeout: 5000 })
```

### Pattern: Verify Visual State

```typescript
// 1. Take baseline screenshot
webview_screenshot({ filePath: 'dev-docs/archive/test-screenshots/before.png' })

// 2. Perform action
webview_interact({ action: 'click', selector: '.toggle-dark-mode' })

// 3. Wait for transition
webview_wait_for({ type: 'selector', value: '[data-theme="dark"]' })

// 4. Take comparison screenshot
webview_screenshot({ filePath: 'dev-docs/archive/test-screenshots/after.png' })

// 5. Check CSS changes
webview_execute_js({ script: `(() => { const s = getComputedStyle(document.querySelector('body')); return Object.fromEntries(["background-color", "color"].map(p => [p, s.getPropertyValue(p)])); })()` })
```

### Pattern: Drag and Drop

```typescript
// Note: Use swipe for drag-and-drop simulation
// 1. Find source element position
const source = webview_find_element({ selector: '.draggable' })

// 2. Find target element position
const target = webview_find_element({ selector: '.drop-zone' })

// 3. Perform drag (long press + swipe)
webview_interact({
  action: 'long-press',
  selector: '.draggable',
  duration: 200
})

webview_interact({
  action: 'swipe',
  fromX: source.rect.x + source.rect.width/2,
  fromY: source.rect.y + source.rect.height/2,
  toX: target.rect.x + target.rect.width/2,
  toY: target.rect.y + target.rect.height/2,
  duration: 500
})
```
