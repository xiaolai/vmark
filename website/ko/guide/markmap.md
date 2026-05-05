# Markmap 마인드맵

VMark는 마크다운 문서에서 직접 대화형 마인드맵 트리를 만들기 위해 [Markmap](https://markmap.js.org/)을 지원합니다. Mermaid의 정적 마인드맵 다이어그램 타입과 달리 Markmap은 일반 마크다운 제목을 입력으로 사용하고 대화형 패닝/줌/접기를 제공합니다.

## 마인드맵 삽입

### 메뉴 사용

**메뉴:** 삽입 > 마인드맵

**키보드 단축키:** `Alt + Shift + Cmd + K` (macOS) / `Alt + Shift + Ctrl + K` (Windows/Linux)

### 코드 블록 사용

`markmap` 언어 식별자와 함께 펜스드 코드 블록을 입력합니다:

````markdown
```markmap
# Mindmap

## Branch A
### Topic 1
### Topic 2

## Branch B
### Topic 3
### Topic 4
```text
````

### MCP 도구 사용

`action: "markmap"`과 마크다운 제목이 포함된 `code` 매개변수로 `media` MCP 도구를 사용합니다.

## 편집 모드

### 리치 텍스트 모드 (WYSIWYG)

WYSIWYG 모드에서 Markmap 마인드맵은 대화형 SVG 트리로 렌더링됩니다. 다음을 수행할 수 있습니다:

- 스크롤하거나 클릭하여 드래그로 **패닝**
- `Cmd`/`Ctrl`을 누르고 스크롤하여 **줌**
- 각 분기의 원을 클릭하여 노드 **접기/펼치기**
- 맞춤 버튼 클릭으로 보기 **맞춤** (호버 시 오른쪽 상단 모서리)
- 마인드맵을 **더블클릭** 하여 소스 편집

### 실시간 미리보기가 있는 소스 모드

소스 모드에서 커서가 markmap 코드 블록 안에 있으면 플로팅 미리보기 패널이 나타나며 입력하면서 업데이트됩니다.

## 입력 형식

Markmap은 표준 마크다운을 입력으로 사용합니다. 제목이 트리 계층 구조를 정의합니다:

| 마크다운 | 역할 |
|---------|------|
| `# Heading 1` | 루트 노드 |
| `## Heading 2` | 첫 번째 수준 분기 |
| `### Heading 3` | 두 번째 수준 분기 |
| `#### Heading 4+` | 더 깊은 분기 |

### 노드의 리치 콘텐츠

노드에는 인라인 마크다운을 포함할 수 있습니다:

````markdown
```markmap
# Project Plan

## Research
### Read **important** papers
### Review [existing tools](https://example.com)

## Implementation
### Write `core` module
### Add tests
- Unit tests
- Integration tests

## Documentation
### API reference
### User guide
```text
````

제목 아래의 목록 항목이 해당 제목의 하위 노드가 됩니다.

### 라이브 데모

이 페이지에서 직접 렌더링된 인터랙티브 마크맵입니다. 패닝, 줌, 노드 접기를 시도해 보세요:

```markmap
# VMark Features

## Editor
### WYSIWYG Mode
### Source Mode
### Focus Mode
### Typewriter Mode

## AI Integration
### MCP Server
### AI Genies
### Smart Paste

## Markdown
### Mermaid Diagrams
### Markmap Mindmaps
### LaTeX Math
### Code Blocks
- Syntax highlighting
- Line numbers

## Platform
### macOS
### Windows
### Linux
```

## 대화형 기능

| 동작 | 방법 |
|------|------|
| **패닝** | 스크롤하거나 클릭하여 드래그 |
| **줌** | `Cmd`/`Ctrl` + 스크롤 |
| **노드 접기** | 분기 지점의 원 클릭 |
| **노드 펼치기** | 원 다시 클릭 |
| **보기 맞춤** | 맞춤 버튼 클릭 (호버 시 오른쪽 상단) |

## 테마 통합

Markmap 마인드맵은 VMark의 현재 테마 (White, Paper, Mint, Sepia, Night)에 자동으로 맞춰집니다. 분기 색상이 모든 테마에서 가독성을 위해 조정됩니다.

## PNG로 내보내기

WYSIWYG 모드에서 렌더링된 마인드맵 위에 마우스를 올리면 **내보내기** 버튼이 나타납니다. 클릭하여 테마를 선택합니다:

| 테마 | 배경 |
|------|------|
| **밝은** | 흰색 배경 |
| **어두운** | 어두운 배경 |

마인드맵은 시스템 저장 대화상자를 통해 2x 해상도 PNG로 내보내집니다.

## 팁

### Markmap vs Mermaid 마인드맵

VMark는 Markmap과 Mermaid의 `mindmap` 다이어그램 타입을 모두 지원합니다:

| 기능 | Markmap | Mermaid 마인드맵 |
|------|---------|-----------------|
| 입력 형식 | 표준 마크다운 | Mermaid DSL |
| 대화형 | 패닝, 줌, 접기 | 정적 이미지 |
| 리치 콘텐츠 | 링크, 굵게, 코드, 목록 | 텍스트만 |
| 적합한 경우 | 크고 대화형 트리 | 간단한 정적 다이어그램 |

대화형 기능이 원하거나 이미 마크다운 콘텐츠가 있을 때 **Markmap** 을 사용합니다. 다른 Mermaid 다이어그램과 함께 필요할 때 **Mermaid 마인드맵** 을 사용합니다.

### 더 알아보기

- **[Markmap 문서](https://markmap.js.org/)** — 공식 참조
- **[Markmap 플레이그라운드](https://markmap.js.org/repl)** — 마인드맵을 테스트하는 대화형 플레이그라운드
