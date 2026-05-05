# MCP 도구 참조

VMark는 AI 어시스턴트에게 **네 가지 복합 MCP 도구** 를 노출합니다: `session`, `workspace`, `document`, `workflow`. 이들은 함께 **14개 액션** 을 다룹니다 — 읽기/쓰기 척추 + 파일/창 라이프사이클 + GitHub Actions YAML을 위한 CST 안전 편집.

이전 12-도구 / 76-액션 표면은 정리되었습니다. 문서 내 서식 도구 (굵게, 제목, 테이블 등)는 AI 에이전트가 마크다운 왕복을 통해 이미 쉽게 수행하는 작업과 중복되기 때문입니다. 전체 근거는 [MCP 정리 계획](https://github.com/xiaolai/vmark/blob/main/dev-docs/plans/20260504-mcp-pruning.md)을 참조하세요.

::: tip 권장 워크플로우
1. `session.get_state`를 한 번 호출하여 열린 창, 탭, 탭별 `{filePath, dirty, revision, kind}`를 확인합니다.
2. 마크다운의 경우: `document.read` → 추론 → `document.write` (안전한 동시성을 위해 `expected_revision` 전달).
3. GitHub Actions YAML (`kind: "yaml-workflow"`)의 경우: 주석과 앵커를 보존하는 CST 안전 편집을 위한 `workflow.apply_patch`; actionlint 진단을 위한 `workflow.validate`.
4. 파일 작업 (열기, 저장, 닫기, 탭 전환)은 `workspace`에 있습니다.
:::

::: tip Mermaid 다이어그램
MCP를 통해 AI로 Mermaid 다이어그램을 생성할 때 [mermaid-validator MCP 서버](/ko/guide/mermaid#mermaid-validator-mcp-server-syntax-checking) 설치를 고려하세요 — 다이어그램이 문서에 도달하기 전에 동일한 Mermaid v11 파서를 사용하여 구문 오류를 잡아냅니다.
:::

---

## `session`

일회성 방향 지정. 단일 호출로 모든 창, 모든 탭, 서버 기능을 검색합니다.

### `get_state`

인수 없음.

**반환** `{windows, capabilities}`:

```json
{
  "windows": [
    {
      "label": "main",
      "focused": true,
      "tabs": [
        {
          "id": "tab-1",
          "filePath": "/path/to/notes.md",
          "title": "notes",
          "dirty": false,
          "revision": "rev-x7Q3aB1F",
          "kind": "markdown"
        },
        {
          "id": "tab-2",
          "filePath": "/repo/.github/workflows/ci.yml",
          "title": "ci",
          "dirty": true,
          "revision": "rev-x7Q3aB1F",
          "kind": "yaml-workflow"
        }
      ]
    }
  ],
  "capabilities": {
    "version": "<vmark-mcp-server version>",
    "supportedKinds": ["markdown", "yaml-workflow"],
    "mcpProtocol": "0.1.0"
  }
}
```

`kind` 판별자는 해당 탭에 `document.write` (마크다운용)를 사용해야 하는지 `workflow.apply_patch` (yaml-workflow용)를 사용해야 하는지 알려줍니다.

---

## `workspace`

파일 및 창 라이프사이클. 문서 내 작업 없음.

### `new`

새 제목 없는 탭을 만듭니다.

| 매개변수 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `kind` | string | 아니오 | `"markdown"` (기본값) 또는 `"yaml-workflow"` |
| `windowLabel` | string | 아니오 | 대상 창; 기본값은 포커스된 창 |

`{tabId}`를 반환합니다.

### `open`

디스크에서 파일을 엽니다.

| 매개변수 | 타입 | 필수 |
|---------|------|------|
| `filePath` | string | 예 |
| `windowLabel` | string | 아니오 |

`{tabId}`를 반환합니다.

### `save`

기존 경로에 탭을 저장합니다.

| 매개변수 | 타입 | 필수 |
|---------|------|------|
| `tabId` | string | 아니오 (기본값은 포커스된 탭) |

`{filePath, revision}`을 반환합니다.

### `save_as`

새 경로에 탭을 저장합니다.

| 매개변수 | 타입 | 필수 |
|---------|------|------|
| `tabId` | string | 아니오 |
| `filePath` | string | 예 |

`{revision}`을 반환합니다.

### `close`

탭을 닫습니다. `force` 없이는 저장되지 않은 작업을 폐기하지 않습니다.

| 매개변수 | 타입 | 필수 |
|---------|------|------|
| `tabId` | string | 예 |
| `force` | boolean | 아니오 |

성공 시 `{closed: true}`를, 탭이 더티 상태이고 `force`가 제공되지 않은 경우 `{closed: false, reason: "DIRTY"}`를 반환합니다.

### `switch_tab`

탭을 활성화합니다.

| 매개변수 | 타입 | 필수 |
|---------|------|------|
| `tabId` | string | 예 |

### `focus_window`

창에 포커스를 줍니다.

| 매개변수 | 타입 | 필수 |
|---------|------|------|
| `windowLabel` | string | 예 |

---

## `document`

읽기, 쓰기, 변환. 표면의 척추.

### `read`

| 매개변수 | 타입 | 필수 |
|---------|------|------|
| `tabId` | string | 아니오 (기본값은 포커스된 탭) |

`{content, revision, filePath, kind, dirty}`를 반환합니다. 쓰기 전에 항상 읽으세요 — `revision` 토큰은 다음 `write`와 함께 전달되어야 합니다.

### `write`

전체 문서 콘텐츠를 교체합니다.

| 매개변수 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `tabId` | string | 아니오 | 대상 탭 (기본값은 포커스된 탭) |
| `content` | string | 예 | 새 전체 콘텐츠 |
| `expected_revision` | string | 아니오 | 가장 최근 read의 리비전 토큰 |

`expected_revision`이 제공되었고 해당 read 이후 문서가 변경된 경우, 응답은 현재 리비전이 포함된 `STALE` 구조화된 오류 봉투입니다; 다시 읽고 재시도하세요.

```json
// 성공
{ "revision": "rev-newAfterWrite" }

// 오래됨
{ "error": "STALE", "message": "Document has changed since the last read", "current_revision": "rev-currentNow" }
```

### `transform`

결정론적 재작성을 적용합니다. 현재 CJK 전용 변환 (전각 ↔ ASCII 구두점 변환, CJK ↔ 라틴 간격)을 지원합니다.

| 매개변수 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `tabId` | string | 아니오 | 대상 탭 |
| `kind` | string | 예 | `"cjk-format"`, `"cjk-spacing"`, 또는 `"cjk-punctuation"` |
| `expected_revision` | string | 아니오 | 동시성 토큰 |

`cjk-format`은 사용자의 CJK 서식 설정을 끝에서 끝까지 적용합니다. `cjk-spacing`은 CJK 문자와 인접한 라틴/숫자 사이에 단일 공백을 삽입합니다. `cjk-punctuation`은 CJK 문자 옆에 있는 ASCII 구두점을 전각 형태로 변환합니다.

`{revision}`을 반환합니다.

---

## `workflow`

GitHub Actions 워크플로우 YAML을 위한 `actionlint` 검증과 **CST 안전 외과적 편집**. `kind`가 `"yaml-workflow"`인 탭에서만 사용 가능합니다.

::: info `document.read` / `document.write`는 워크플로우 YAML을 포함한 모든 탭에서 작동합니다
`workflow` 도구는 읽기/쓰기 척추를 **대체** 하지 않습니다. 워크플로우 탭의 경우 다음을 수행할 수 있습니다:

- `document.read`로 원시 YAML 텍스트를 가져옵니다 (모든 주석 포함)
- `document.write`로 통째로 교체합니다 (보내는 문자열이 그대로 저장됨 — 주석을 포함하면 보존됨)
- 부분 편집 시 주석, 앵커, 키 순서가 살아남도록 **서버 자체가 보장** 하기를 원할 때 `workflow.apply_patch`

한 필드를 변경하고 나머지는 그대로 두려면 `apply_patch`를 사용하세요 (서버는 변경하지 않는 주석을 떨어뜨릴 수 없음). 통째로 다시 작성하거나 처음부터 새 워크플로우를 생성할 때는 `document.write`를 사용하세요.
:::

### `apply_patch`

`IRPatch` 객체 배열을 적용합니다. 패치는 주석, 앵커, 키 순서를 보존하는 VMark의 CST 인식 변환기를 통해 디스패치됩니다. YAML 파일에 대한 원시 `document.write`는 이들을 잃을 수 있습니다.

| 매개변수 | 타입 | 필수 |
|---------|------|------|
| `tabId` | string | 아니오 |
| `patches` | IRPatch[] | 예 |
| `expected_revision` | string | 아니오 |

`IRPatch`는 판별 유니온입니다 (`kind` 필드). 지원되는 종류:

| `kind` | 효과 |
|--------|------|
| `workflow.set` | 최상위 필드 설정 (`{path, value}`) — `name`, `env.X` 등 |
| `job.set` | 작업의 필드 설정 (`{jobId, path, value}`) |
| `step.set` | 단계의 필드 설정 (`{jobId, stepIndex, path, value}`) |
| `with.set` | 단계의 `with:` 블록에서 키 설정 (`{jobId, stepIndex, key, value}`) |
| `with.remove` | 단계의 `with:` 블록에서 키 제거 |
| `needs.add` / `needs.remove` | `needs:`에서 작업 ID 추가 또는 제거 |
| `trigger.setFilters` | 트리거 필터 배열 교체 — branches, paths, types 등 (`{event, filter, value: string[]}`) |

성공 시 `{revision}`을, 또는 구조화된 `STALE` / `INVALID_PATCH` / `NOT_WORKFLOW` 오류 봉투를 반환합니다.

### `validate`

워크플로우 YAML에 대해 `actionlint`를 실행합니다.

| 매개변수 | 타입 | 필수 |
|---------|------|------|
| `tabId` | string | 아니오 |

`{ok, diagnostics, binaryAvailable}`을 반환합니다. 각 진단에는 `{line, col, message, severity}`가 포함됩니다. `binaryAvailable: false`는 `actionlint`가 로컬에 설치되어 있지 않음을 의미합니다; Homebrew 또는 업스트림 릴리스를 통해 설치하세요.

---

## 오류

두 가지 오류 형태가 나타납니다:

**도메인 오류** — `success: false`를 설정하고 `error`에 JSON 인코딩된 봉투를 반환합니다:

```json
{ "error": "STALE", "message": "...", "current_revision": "rev-..." }
```

**인수 형식 오류** — 누락된/잘못된 필수 인수의 경우 (예: `content` 필드 없는 `document.write`), `error`는 문제를 설명하는 일반 문자열입니다. 구조화된 봉투는 도메인 수준 조건을 위해 예약되어 있습니다.

| 코드 | 표현 형식 | 의미 |
|------|----------|------|
| `STALE` | 봉투 | `expected_revision`이 일치하지 않음; 다시 읽고 재시도하세요 |
| `INVALID_PATCH` | 봉투 | `workflow.apply_patch`가 잘못된 형식의 `patches` 배열을 받음 |
| `INVALID_TAB` | 봉투 | `tabId`를 해석할 수 없음 |
| `INVALID_PATH` | 봉투 | `workspace.open`이 읽을 수 없는 `filePath`를 받음 |
| `NOT_WORKFLOW` | 봉투 | YAML 워크플로우가 아닌 탭에서 `workflow.*`가 호출됨 |
| `READ_ONLY` | 봉투 | 읽기 전용 문서에 대해 변형이 시도됨 |
| `INTERNAL` | 봉투 | 예기치 못한 핸들러 오류 |
| (일반 문자열) | 문자열 | 필수 인수 누락 또는 잘못된 타입 |
