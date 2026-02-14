# Webview Testing

## Overview

The `tauri_webview_*` tools interact with the DOM inside a Tauri app's webview. These tools provide full control over element discovery, interaction, and verification.

## Element Discovery

### Find Elements

```typescript
// Find by CSS selector
tauri_webview_find_element({ selector: '.editor-content' })

// Find by XPath
tauri_webview_find_element({
  selector: '//div[@class="editor"]//p',
  strategy: 'xpath'
})

// Find by text content
tauri_webview_find_element({
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
tauri_webview_screenshot()
```

### Specific Element

```typescript
tauri_webview_screenshot({ uid: 'element-abc123' })
```

### Save to File

```typescript
tauri_webview_screenshot({
  filePath: 'dev-docs/archive/test-screenshots/screenshot.png',
  format: 'png'
})

// JPEG with quality
tauri_webview_screenshot({
  filePath: 'dev-docs/archive/test-screenshots/screenshot.jpg',
  format: 'jpeg',
  quality: 80
})
```

## Interactions

### Click Actions

```typescript
// Single click
tauri_webview_interact({ action: 'click', selector: '.button' })

// Double click
tauri_webview_interact({ action: 'double-click', selector: '.item' })

// Long press (touch)
tauri_webview_interact({
  action: 'long-press',
  selector: '.context-trigger',
  duration: 500  // ms
})

// Click by coordinates
tauri_webview_interact({ action: 'click', x: 150, y: 200 })
```

### Focus

```typescript
tauri_webview_interact({ action: 'focus', selector: 'input.search' })
```

### Scrolling

```typescript
// Scroll element vertically
tauri_webview_interact({
  action: 'scroll',
  selector: '.scrollable-content',
  scrollY: 500  // pixels down
})

// Scroll horizontally
tauri_webview_interact({
  action: 'scroll',
  selector: '.horizontal-list',
  scrollX: 200  // pixels right
})

// Scroll both directions
tauri_webview_interact({
  action: 'scroll',
  selector: '.canvas',
  scrollX: 100,
  scrollY: 200
})
```

### Swipe Gestures

```typescript
// Swipe left
tauri_webview_interact({
  action: 'swipe',
  fromX: 300, fromY: 400,
  toX: 100, toY: 400,
  duration: 300
})

// Swipe up (scroll down on mobile)
tauri_webview_interact({
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
tauri_webview_keyboard({
  action: 'type',
  selector: 'textarea.content',
  text: 'Hello, World!'
})

// Type multiline
tauri_webview_keyboard({
  action: 'type',
  selector: '.editor',
  text: '# Title\n\nParagraph text here.'
})
```

### Key Press

```typescript
// Single key
tauri_webview_keyboard({ action: 'press', key: 'Enter' })
tauri_webview_keyboard({ action: 'press', key: 'Escape' })
tauri_webview_keyboard({ action: 'press', key: 'Tab' })

// Arrow keys
tauri_webview_keyboard({ action: 'press', key: 'ArrowDown' })
tauri_webview_keyboard({ action: 'press', key: 'ArrowRight' })
```

### Key Combinations

```typescript
// Ctrl+S (Save)
tauri_webview_keyboard({
  action: 'press',
  key: 's',
  modifiers: ['Control']
})

// Cmd+Shift+Z (Redo on macOS)
tauri_webview_keyboard({
  action: 'press',
  key: 'z',
  modifiers: ['Meta', 'Shift']
})

// Ctrl+Alt+Delete
tauri_webview_keyboard({
  action: 'press',
  key: 'Delete',
  modifiers: ['Control', 'Alt']
})
```

### Key Down/Up (Hold)

```typescript
// Hold Shift while clicking
tauri_webview_keyboard({ action: 'down', key: 'Shift' })
tauri_webview_interact({ action: 'click', selector: '.item:last-child' })
tauri_webview_keyboard({ action: 'up', key: 'Shift' })
```

## Waiting

### Wait for Element

```typescript
// Wait for element to appear
tauri_webview_wait_for({
  type: 'selector',
  value: '.loading-complete',
  timeout: 10000  // 10 seconds
})
```

### Wait for Text

```typescript
// Wait for specific text
tauri_webview_wait_for({
  type: 'text',
  value: 'Operation successful',
  timeout: 5000
})
```

### Wait for IPC Event

```typescript
// Wait for Tauri event
tauri_webview_wait_for({
  type: 'ipc-event',
  value: 'document-saved',
  timeout: 5000
})
```

## CSS Styles

### Get Computed Styles

```typescript
// All computed styles
tauri_webview_get_styles({ selector: '.editor' })

// Specific properties
tauri_webview_get_styles({
  selector: '.editor',
  properties: ['font-size', 'font-family', 'color', 'background-color']
})
```

### Multiple Elements

```typescript
// Get styles from all matching elements
tauri_webview_get_styles({
  selector: '.toolbar-button',
  multiple: true,
  properties: ['opacity', 'background-color']
})
```

## JavaScript Execution

### Basic Execution

```typescript
// Execute without return value
tauri_webview_execute_js({
  script: 'console.log("Test running")'
})
```

### Return Values (IIFE Required)

```typescript
// CORRECT: Use IIFE for return values
tauri_webview_execute_js({
  script: '(() => { return document.title; })()'
})

// WRONG: This returns undefined
tauri_webview_execute_js({
  script: 'return document.title;'  // Won't work!
})
```

### Complex Operations

```typescript
// Get element count
tauri_webview_execute_js({
  script: '(() => { return document.querySelectorAll(".item").length; })()'
})

// Check state
tauri_webview_execute_js({
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
tauri_webview_execute_js({
  script: '(() => { return window.__TAURI__.app.getName(); })()'
})
```

## Testing Patterns

### Pattern: Form Fill and Submit

```typescript
// 1. Fill form fields
tauri_webview_keyboard({
  action: 'type',
  selector: '#username',
  text: 'testuser'
})

tauri_webview_keyboard({
  action: 'type',
  selector: '#password',
  text: 'testpass123'
})

// 2. Submit form
tauri_webview_interact({ action: 'click', selector: 'button[type="submit"]' })

// 3. Wait for result
tauri_webview_wait_for({ type: 'selector', value: '.dashboard', timeout: 5000 })
```

### Pattern: Verify Visual State

```typescript
// 1. Take baseline screenshot
tauri_webview_screenshot({ filePath: 'dev-docs/archive/test-screenshots/before.png' })

// 2. Perform action
tauri_webview_interact({ action: 'click', selector: '.toggle-dark-mode' })

// 3. Wait for transition
tauri_webview_wait_for({ type: 'selector', value: '[data-theme="dark"]' })

// 4. Take comparison screenshot
tauri_webview_screenshot({ filePath: 'dev-docs/archive/test-screenshots/after.png' })

// 5. Check CSS changes
tauri_webview_get_styles({
  selector: 'body',
  properties: ['background-color', 'color']
})
```

### Pattern: Drag and Drop

```typescript
// Note: Use swipe for drag-and-drop simulation
// 1. Find source element position
const source = tauri_webview_find_element({ selector: '.draggable' })

// 2. Find target element position
const target = tauri_webview_find_element({ selector: '.drop-zone' })

// 3. Perform drag (long press + swipe)
tauri_webview_interact({
  action: 'long-press',
  selector: '.draggable',
  duration: 200
})

tauri_webview_interact({
  action: 'swipe',
  fromX: source.rect.x + source.rect.width/2,
  fromY: source.rect.y + source.rect.height/2,
  toX: target.rect.x + target.rect.width/2,
  toY: target.rect.y + target.rect.height/2,
  duration: 500
})
```
