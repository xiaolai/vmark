# Mermaid Diagrams

VMark supports [Mermaid](https://mermaid.js.org/) diagrams for creating flowcharts, sequence diagrams, and other visualizations directly in your Markdown documents.

![Mermaid diagram rendered in WYSIWYG mode](/screenshots/mermaid-wysiwyg.png)

## Inserting a Diagram

### Using Keyboard Shortcut

Type a fenced code block with the `mermaid` language identifier:

````markdown
```mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Do something]
    B -->|No| D[Do another thing]
```
````

### Using Slash Command

1. Type `/` to open the command menu
2. Select **Mermaid Diagram**
3. A template diagram is inserted for you to edit

## Editing Modes

### Rich Text Mode (WYSIWYG)

In WYSIWYG mode, Mermaid diagrams are rendered inline as you type. Click on a diagram to edit its source code.

### Source Mode with Live Preview

In Source mode, a floating preview panel appears when your cursor is inside a mermaid code block:

![Live preview panel in Source mode](/screenshots/mermaid-source-preview.png)

| Feature | Description |
|---------|-------------|
| **Live Preview** | See rendered diagram as you type (200ms debounce) |
| **Drag to Move** | Drag the header to reposition the preview |
| **Resize** | Drag any edge or corner to resize |
| **Zoom** | Use `−` and `+` buttons (10% to 300%) |

The preview panel remembers its position if you move it, making it easy to arrange your workspace.

## Supported Diagram Types

VMark supports all Mermaid diagram types:

### Flowchart

```mermaid
graph LR
    A[Start] --> B{Is it working?}
    B -->|Yes| C[Great!]
    B -->|No| D[Debug]
    D --> B
```

````markdown
```mermaid
graph LR
    A[Start] --> B{Is it working?}
    B -->|Yes| C[Great!]
    B -->|No| D[Debug]
    D --> B
```
````

### Sequence Diagram

```mermaid
sequenceDiagram
    Alice->>Bob: Hello Bob!
    Bob-->>Alice: Hi Alice!
    Alice->>Bob: How are you?
    Bob-->>Alice: I'm good, thanks!
```

````markdown
```mermaid
sequenceDiagram
    Alice->>Bob: Hello Bob!
    Bob-->>Alice: Hi Alice!
```
````

### Class Diagram

```mermaid
classDiagram
    Animal <|-- Duck
    Animal <|-- Fish
    Animal : +int age
    Animal : +String gender
    Animal : +swim()
    Duck : +String beakColor
    Duck : +quack()
```

````markdown
```mermaid
classDiagram
    Animal <|-- Duck
    Animal <|-- Fish
    Animal : +int age
    Animal : +swim()
```
````

### State Diagram

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Processing : Start
    Processing --> Complete : Done
    Processing --> Error : Fail
    Complete --> [*]
    Error --> Idle : Retry
```

````markdown
```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Processing : Start
    Processing --> Complete : Done
```
````

### Entity Relationship Diagram

```mermaid
erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
    PRODUCT ||--o{ LINE-ITEM : "is in"
```

````markdown
```mermaid
erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
```
````

### Gantt Chart

```mermaid
gantt
    title Project Timeline
    dateFormat  YYYY-MM-DD
    section Phase 1
    Research    :a1, 2024-01-01, 30d
    Design      :a2, after a1, 20d
    section Phase 2
    Development :a3, after a2, 40d
    Testing     :a4, after a3, 15d
```

````markdown
```mermaid
gantt
    title Project Timeline
    dateFormat  YYYY-MM-DD
    section Phase 1
    Research    :a1, 2024-01-01, 30d
```
````

### Pie Chart

```mermaid
pie title Distribution
    "Category A" : 40
    "Category B" : 30
    "Category C" : 20
    "Category D" : 10
```

````markdown
```mermaid
pie title Distribution
    "Category A" : 40
    "Category B" : 30
```
````

### Git Graph

```mermaid
gitGraph
    commit
    commit
    branch develop
    checkout develop
    commit
    commit
    checkout main
    merge develop
    commit
```

````markdown
```mermaid
gitGraph
    commit
    branch develop
    commit
    checkout main
    merge develop
```
````

## Tips

### Syntax Errors

If your diagram has a syntax error:
- In WYSIWYG mode: the code block shows the raw source
- In Source mode: the preview shows "Invalid mermaid syntax"

Check the [Mermaid documentation](https://mermaid.js.org/intro/) for correct syntax.

### Theme Integration

Mermaid diagrams automatically adapt to VMark's current theme (light or dark mode).

### Export

When exporting to HTML or PDF, Mermaid diagrams are rendered as SVG images for crisp display at any resolution.

## Learn More

- [Mermaid Official Documentation](https://mermaid.js.org/)
- [Mermaid Live Editor](https://mermaid.live/) - Test diagrams online
- [Mermaid Cheat Sheet](https://mermaid.js.org/syntax/flowchart.html)
