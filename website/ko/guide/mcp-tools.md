# MCP 도구 참조

VMark는 AI 어시스턴트에게 **아홉 가지 복합 MCP 도구** 를 노출합니다: `session`, `workspace`, `document`, `workflow`, `selection`, `browser`, `browser_read`, `coherence`, `coherence_resolve`. 이들은 함께 편집기 척추, 파일/창 라이프사이클, CST 안전 워크플로우 편집, 선택 영역 대상 편집, 제한된 브라우저 탐색, 그리고 워크스페이스 정합성 레이어의 뷰를 다룹니다.

아홉 가지 중 셋 — `session`, `browser_read`, `coherence` — 은 `readOnlyHint: true`를 선언하므로 MCP 클라이언트가 자동 승인할 수 있습니다. `browser`/`browser_read`와 `coherence`/`coherence_resolve`가 애초에 별개의 도구인 이유가 바로 이것입니다: 주석(annotation)은 액션별이 아니라 **도구별** 이므로, ARIA 스냅샷과 `execute_js`를 한데 묶은 도구는 `execute_js`의 위험성을 알려야 합니다. "이것이 무언가를 수정하는가?"를 기준으로 분리하면 각 절반이 진실을 말할 수 있고, 표면에서 정말로 파괴적인 액션들이 도구 목록에서 눈에 띄게 유지됩니다.

이전 12-도구 / 76-액션 표면은 정리되었습니다. 문서 내 서식 도구 (굵게, 제목, 테이블 등)는 AI 에이전트가 마크다운 왕복을 통해 이미 쉽게 수행하는 작업과 중복되기 때문입니다. `selection`은 (정리 계획의 ADR-7에 따라) 유지되었는데, 큰 파일에서는 전체 문서 왕복이 비경제적이기 때문입니다 — 편집할 때마다 전체 문서를 입력 토큰으로, 전체 문서를 출력 토큰으로 (입력의 약 5배 가격) 지불하며, 쓰기 창이 길어져 오래된 리비전 재시도 루프가 넓어집니다. 전체 근거는 [MCP 정리 계획](https://github.com/xiaolai/vmark/blob/main/dev-docs/plans/20260504-mcp-pruning.md)을 참조하세요.

::: tip 권장 워크플로우
1. `session.get_state`를 한 번 호출하여 열린 창, 탭, 탭별 `{filePath, dirty, revision, kind}`를 확인합니다.
2. 작은 마크다운 변경이나 통째 재작성의 경우: `document.read` → 추론 → `document.write` (안전한 동시성을 위해 `expected_revision` 전달).
3. 사용자가 변경할 영역을 선택한 큰 마크다운 파일의 대상 편집의 경우: `selection.get` → 추론 → `selection.set` (입력과 출력 토큰 비용을 선택 영역으로 줄여줍니다).
4. GitHub Actions YAML (`kind: "yaml-workflow"`)의 경우: 주석과 앵커를 보존하는 CST 안전 편집을 위한 `workflow.apply_patch`; actionlint 진단을 위한 `workflow.validate`.
5. 파일 작업 (열기, 저장, 닫기, 탭 전환)은 `workspace`에 있습니다.
:::

::: tip Mermaid 다이어그램
MCP를 통해 AI로 Mermaid 다이어그램을 생성할 때 [mermaid-validator MCP 서버](/guide/mermaid#mermaid-validator-mcp-server-syntax-checking) 설치를 고려하세요 — 다이어그램이 문서에 도달하기 전에 동일한 Mermaid v11 파서를 사용하여 구문 오류를 잡아냅니다.
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
      "activeWorkspaceInstanceId": "wsi-a1b2c3",
      "tabs": [
        {
          "id": "tab-1",
          "filePath": "/path/to/notes.md",
          "title": "notes",
          "dirty": false,
          "revision": "rev-x7Q3aB1F",
          "kind": "markdown",
          "active": true,
          "visible": true
        },
        {
          "id": "tab-2",
          "filePath": "/repo/.github/workflows/ci.yml",
          "title": "ci",
          "dirty": true,
          "revision": "rev-x7Q3aB1F",
          "kind": "yaml-workflow",
          "active": false,
          "visible": false
        }
      ]
    }
  ],
  "capabilities": {
    "version": "<vmark-mcp-server version>",
    "supportedKinds": ["markdown", "yaml-workflow"],
    "mcpProtocol": "0.2.0"
  }
}
```

#### 화면에 실제로 무엇이 있는지 알기

탭은 존재하고, 주소로 지정 가능하면서도, 여전히 표시되지 않을 수 있습니다. 세 가지 필드가 이를 알려줍니다:

| 필드 | 의미 |
|---|---|
| `tab.active` | 이 탭이 해당 창의 현재 탭입니다. |
| `tab.visible` | 이 탭이 지금 렌더링됩니다. 창이 현재 표시하지 않는 워크스페이스 인스턴스에 탭이 속해 있으면 `false`입니다. |
| `window.activeWorkspaceInstanceId` | 창이 표시하고 있는 워크스페이스 인스턴스, 또는 워크스페이스 레일이 꺼져 있으면 `null` (이 경우 모든 탭이 표시됨). |

`window.focused`는 운영 체제에서 읽은, **사용자** 가 보고 있는 창입니다. 이는 "이 요청에 응답한 창"이 아닙니다 — VMark는 요청을 해당 워크스페이스를 소유한 창으로 라우팅하며, 다중 창 세션에서는 종종 다른 창입니다.

이들을 확인 단계로 취급하세요: `workspace.switch_tab` 이후, 후속 `get_state`가 탭이 실제로 사용자 앞에 있는지 알려줍니다. `switch_tab` 자체는 응답하기 전에 스토어를 다시 읽으므로, 활성화가 이루어지지 않았을 때 요청을 그대로 되돌려주는 대신 `activated: false`를 보고합니다.

`kind` 판별자는 해당 탭에 `document.write` (마크다운용)를 사용해야 하는지 `workflow.apply_patch` (yaml-workflow용)를 사용해야 하는지 알려줍니다.

---

## `workspace`

파일 및 창 라이프사이클. 문서 내 작업 없음.

> **경로 범위.** 파일 작업 (`open`, `save`, `save_as`)은 열린
> 워크스페이스 루트와 이미 열린 문서의 디렉터리로 제한됩니다. 이 범위를
> 벗어난 경로에 대한 요청은 `INVALID_PATH`로 거부됩니다. 워크스페이스가
> 없고 열린 문서도 없으면 범위가 없으므로 파일 작업이 거부됩니다. 이는
> 자동화된 클라이언트가 당신이 연 것 안에서만 동작하도록 유지합니다.

### `new`

새 제목 없는 탭을 만듭니다.

| 매개변수 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `kind` | string | 아니오 | `"markdown"` (기본값) 또는 `"yaml-workflow"` |
| `windowLabel` | string | 아니오 | 대상 창; 기본값은 포커스된 창 |

`{tabId}`를 반환합니다.

### `open`

디스크에서 **파일** 을 **백그라운드** 탭으로 엽니다 — 사용자에게 보이는 탭과 워크스페이스는 바뀌지 않습니다. 반환된 `tabId`를 `document` / `selection` 호출로 이어서 사용하세요; 사용자가 탭을 *봐야* 할 때만 `switch_tab`을 사용하세요.

| 매개변수 | 타입 | 필수 |
|---------|------|------|
| `filePath` | string | 예 |
| `windowLabel` | string | 아니오 |

`{tabId, workspaceInstanceId, activationChanged, workspaceSwitched}`를 반환합니다.

### `open_workspace`

**폴더** 를 활성 워크스페이스로 엽니다. `open` (이미 동의된 트리 안의 단일 파일) 과 달리, 이는 어시스턴트에게 완전히 새로운 파일 트리에 대한 접근 권한을 부여하므로 **일회성 사용자 승인으로 게이트** 되며 위의 경로 범위에 포함되지 않습니다.

| 매개변수 | 타입 | 필수 |
|---------|------|------|
| `folderPath` | string | 예 |

`new`나 `open`과 달리 여기서는 `windowLabel`이 **허용되지 않습니다**. 폴더는 항상 요청이 도착한 창에서 열립니다. 이는 의도적입니다: 승인 대화 상자와 열기 작업이 같은 창에 도달해야 하는데, 클라이언트가 제공한 레이블은 한 창 앞에 프롬프트를 띄우면서 다른 창을 변경할 수 있습니다 — 한 가지를 승인하고 다른 것을 얻는 셈입니다. 다중 창 타깃팅은 아직 존재하지 않는 요청 라우팅이 필요합니다.

**승인 흐름.** 첫 호출은 `{needsApproval: true}`를 반환하고 *정규* 폴더 경로 (심링크 해석됨) 를 명시하는 동의 대화 상자를 띄웁니다. 어시스턴트는 사용자에게 물어본 다음 **같은 호출을 재시도** 해야 합니다; 사용자가 승인하면 재시도가 폴더를 엽니다. 거부된 요청은 다시 승인될 때까지 계속 실패합니다. "기억하기" 옵션은 없습니다 — 각 열기는 개별적으로 승인됩니다.

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

탭 자신의 현재 파일이 아닌 경로에 저장하는 것은 새 쓰기로 취급됩니다. **편집 자동 승인** (설정 → 통합) 이 꺼져 있으면 (기본값), 그러한 요청은 `APPROVAL_REQUIRED`로 거부되고 토스트가 무엇이 차단되었는지 알려줍니다. 탭 자신의 경로로 다시 저장하는 것은 항상 허용됩니다.

### `close`

탭을 닫습니다. `force` 없이는 저장되지 않은 작업을 폐기하지 않습니다.

| 매개변수 | 타입 | 필수 |
|---------|------|------|
| `tabId` | string | 예 |
| `force` | boolean | 아니오 |

성공 시 `{closed: true}`를, 탭이 더티 상태이고 `force`가 제공되지 않은 경우 `{closed: false, reason: "DIRTY"}`를 반환합니다.

### `switch_tab`

탭을 활성화하고 **표시** 되게 합니다. [워크스페이스 레일](/guide/workspace-rail) 이 활성화되어 있으면 이는 사용자의 활성 워크스페이스 컨텍스트를 전환할 수 있습니다 — 그럴 경우 응답이 `workspaceSwitched: true`를 보고하므로 어시스턴트는 사용자에게 알려야 합니다.

| 매개변수 | 타입 | 필수 |
|---------|------|------|
| `tabId` | string | 예 |

`{activated, workspaceSwitched, workspaceInstanceId, activeTabId}`를 반환합니다.

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

## `selection`

사용자의 현재 편집기 선택 영역을 읽거나 교체합니다. 사용자가 변경할 영역을 강조 표시했을 때 `document.read`/`document.write` 대신 이것을 사용하세요 — `selection.get`은 선택된 조각만 반환하고, `selection.set`은 그 범위만 다시 작성하므로 토큰 비용이 문서가 아니라 편집에 비례합니다.

::: warning 선택 영역은 뷰 상태입니다 — 포커스된 탭 전용
선택 영역은 현재 렌더링된 편집기에만 존재합니다. `tabId`가 제공되면 포커스된 탭과 일치해야 합니다; 불일치하면 `INVALID_TAB`을 반환합니다. 포커스된 탭에 활성 편집기가 없으면 (예: 읽기 전용 뷰어), 응답은 `NO_EDITOR`입니다.
:::

### `get`

| 매개변수 | 타입 | 필수 |
|---------|------|------|
| `tabId` | string | 아니오 |

반환:

| 필드 | 타입 | 참고 |
|---|---|---|
| `text` | string | 선택된 조각의 마크다운 직렬화 (WYSIWYG 모드), 또는 선택된 원시 텍스트 (소스 모드). 축소된 경우 빈 문자열. |
| `isEmpty` | boolean | 선택 영역이 축소되었을 때 (커서만) `true`. |
| `range` | `{from, to}` | WYSIWYG 모드에서는 ProseMirror 위치; 소스 모드에서는 문자 오프셋. |
| `mode` | `"wysiwyg"` \| `"source"` | `range`의 위치 공간을 명확히 구분합니다. |
| `kind` | `"markdown"` \| `"yaml-workflow"` | 문서 종류 판별자. |
| `tabId` | string | 확인을 위해 되돌려줌. |
| `revision` | string | 낙관적 동시성을 위해 `set`에 다시 전달. |

### `set`

| 매개변수 | 타입 | 필수 |
|---------|------|------|
| `tabId` | string | 아니오 |
| `content` | string | 예 |
| `expected_revision` | string | 아니오 (권장) |

편집기가 현재 선택 영역으로 보고하는 것을 무엇이든 교체합니다. **WYSIWYG 모드에서는**, 일반 인라인 텍스트가 리터럴 텍스트 노드로 삽입되므로 선행/후행 공백이 정확히 왕복됩니다; 마크다운 마커 (`**bold**`, `*italic*`, `` `code` ``, 펜스 코드, 인용구, 목록 등) 를 담은 콘텐츠는 마크다운으로 파싱되어 해당 노드로 삽입됩니다. **소스 모드에서는**, `content`가 항상 원시 텍스트로 이어 붙여집니다 — 소스 표면은 이미 마크다운 바이트입니다. 빈 `content`는 선택 영역을 삭제합니다. 선택 영역이 축소된 경우, `content`는 커서 위치에 삽입됩니다.

성공 시 `{revision, replaced_chars}`를 반환합니다. `replaced_chars`는 호출 전에 선택되어 있던 텍스트의 길이입니다 — AI가 예상한 것을 편집했는지 확인하는 데 유용합니다.

`STALE`은 `document.write`와 똑같이 `{error: "STALE", message, current_revision}`을 반환합니다. 문서 수준 리비전은 `get`과 `set` 사이의 키 입력을 잡아냅니다. 순수한 커서 이동은 (키 입력 없이) 서버가 중재하지 않습니다 — 사용자가 `get`과 `set` 사이에 커서를 옮겼다면, 편집은 새 위치에 적용됩니다.

---

## `browser`

내장 브라우저 표면의 **변경** 절반 — 페이지, 탭, 또는 저장된 로그인을 바꾸는 모든 것. 먼저 [`browser_read`](#browser-read)로 페이지를 읽으세요: 여기의 모든 타깃팅 모드는 읽기가 반환한 것을 참조합니다.

브라우저 도구는 **설정 → 고급 → macOS → 내장 브라우저** 를 따르며, 이는 macOS에서 **기본적으로 켜져 있습니다** — 따라서 끄지 않는 한 이 도구들은 연결된 AI 클라이언트에서 사용할 수 있습니다. 꺼져 있는 동안 모든 액션은 `BROWSER_DISABLED`로 실패합니다. MCP로 반환되는 URL은 앱의 브라우저 세션 상태에 사용되는 동일한 경계를 통해 편집(redact)됩니다.

`readOnlyHint: false, destructiveHint: true`로 주석 처리됩니다 — 여기의 모든 액션이 무언가를 변경하므로 단순히 보수적인 것이 아니라 정확합니다.

### `act`

인수: `tabId?`, `operation: "click" | "type" | "scroll" | "key"`, 그리고 작업별 타깃:

- **click / type** — 타깃으로 `ref` (이전 읽기에서) **또는** `role` + `name`, 그리고 입력을 위한 `text?`. `ref`는 정밀하고 순서에 무관하지만 **이미 승인된** 작업에 대해서만 존중됩니다; 액션에 승인이 필요할 수 있으면 프롬프트가 사용자에게 읽을 수 있는 요소를 보여주도록 `role` + `name`을 사용하세요.
- **scroll** — `ref` (뷰로 스크롤) **또는** `dy` (세로 픽셀 델타).
- **key** — `key` (예: `"Enter"`, `"Escape"`, `"Tab"`), 타깃을 지정할 선택적 `ref`, 그리고 선택적 `modifiers: {ctrl, shift, alt, meta}`.

`scroll`과 `key`는 act 클래스 (승인 게이트) 이며 **합성** DOM 이벤트를 디스패치하므로, `event.isTrusted`로 게이팅하는 사이트는 이들을 무시할 수 있습니다. 변경 작업에는 오리진 범위의 승인이 필요합니다; AI가 선택한 업로드는 결코 허용되지 않습니다.

**클릭은 성공을 보고하기 전에 그 효과를 검증합니다.** 타깃은 뷰로 스크롤되고, 눈에 보이게 렌더링되어야 하며 (계산된 스타일과 축소된 조상이 확인되므로, 닫힌 아코디언 단계 안의 중복 버튼은 클릭되지 않고 건너뜁니다), 클릭 지점이 히트 테스트됩니다 — 오버레이로 가려진 타깃은 관통 클릭되지 않고 가리는 요소가 명시된 채 (`covered by div.cmp-overlay`) 거부됩니다. role + name 결과는 모호성이 드러나도록 `matchedTotal` / `matchedVisible` 카운트를 담고, 모든 act 응답은 탭의 현재 `url`과 `generation`을 포함합니다. `type`은 텍스트 필드, `<select>` 컨트롤 (옵션의 레이블 또는 값을 전달; 없는 옵션은 `no-such-option`으로 거부됨), 그리고 `contenteditable` 영역을 처리합니다.

### `workflow_run` / `workflow_cancel`

`workflow_run`은 AI 소유 탭에서 `source` 텍스트로 제공하는 워크플로우를 실행합니다. 인수: `tabId?`, `source` (워크플로우 텍스트 — 작은 줄 지향 문법; 이 빌드에서는 당신이 작성하거나 AI가 작성하며, 앱 내 레코더가 출시되면 그것이 생성할 형식이기도 합니다), `inputs?` (`{name}` 참조에 치환되는 `{name: value}` 맵), `allowRepeat?`. 이는 **즉시** `{runId, steps}`를 반환합니다 — 다단계 실행이 단일 요청보다 오래 지속될 수 있으므로 실행은 **비동기적으로** 이루어집니다. 진행 상황은 [`browser_read`](#browser-read)의 `workflow_status`를 폴링하세요.

결정론적 단계 — 그 문법에서의 `click` / `type` / `navigate`, 그리고 `extract` — 는 VMark 내부에서 실행되며 손으로 발행한 `act`와 똑같이 **개별적으로 승인 게이트** 됩니다: 실행은 각각을 개별적으로 인가하므로 워크플로우는 승인 프롬프트를 우회하는 방법이 아닙니다. `goal`, `confirm`, `api`, 그리고 모든 자유 산문 단계는 AI가 직접 처리하도록 실행을 **일시 중지** 합니다. 재실행은 `allowRepeat`이 설정되지 않는 한 이번 세션에서 **이미 성공한 쓰기 단계를 건너뜁니다** (완료된 쓰기 원장) — 따라서 일시 중지 후 재실행해도 이중 제출되지 않습니다.

`workflow_cancel {tabId?, runId}`은 실행을 중지합니다. 이는 **결코 승인 게이트되지 않으며** — 중지는 항상 허용됩니다 — 실행의 대기 중인 프롬프트를 철회하고 탭을 당신에게 돌려줍니다. 브라우저를 넘겨받는 순간 실행도 중지됩니다 (페이지나 그 크롬과의 모든 상호작용이 제어권을 되찾습니다).

실행은 제한됩니다 (≤ 25단계, ≤ 120초, source ≤ 64 KiB) 그리고 탭당 한 번에 하나씩입니다.

### `open`

인수: `url` 및 선택적 `timeoutMs` (1–12,000 ms). 현재 Sandbox 또는 Shared 자세(posture)를 사용하여 AI 소유 탭을 만들고 로드가 완료된 후 그 `tabId`, `navigationId`, URL, 제목, generation을 반환합니다.

### `navigate`

인수: `tabId?`, `url`, 및 선택적 `timeoutMs`. AI 소유 탭을 탐색하고 탐색 티켓 결과를 반환합니다. 타임아웃이 발생해도 티켓을 반환하므로 나중에 `wait`가 최종 결과를 가져올 수 있습니다.

**게이트 감지.** 로드된 `open` / `navigate` / `wait` 결과는 도착한 페이지가 **로그인 벽**, **동의 간지 페이지**, **인간 확인 챌린지**, 또는 **속도 제한** 으로 읽힐 때 `gate: {kind, hint}`를 담을 수 있습니다 — 그래서 AI는 결과를 읽는 순간, 자신이 요청한 콘텐츠를 보고 있지 않다는 것을 알게 됩니다. 감지는 정밀도 우선이며 (렌더링된 챌린지 위젯, 또는 간결한 페이지에서 최소 두 개의 독립 신호 — `$429` 가격, "Protected by Cloudflare" 푸터, 또는 CAPTCHA에 *관한* 기사는 결코 분류되지 않습니다) 순전히 자문에 그칩니다: AI에게 전달되는 내용을 바꿀 뿐 인가되는 것은 결코 바꾸지 않으며, 모든 힌트는 게이트를 우회하기보다 당신을 관여시키는 쪽을 가리킵니다.

### `style`

인수: `tabId?`, 타깃 (`ref` **또는** `selector`), 그리고 `set: {prop: value}`, `addClasses`, `removeClasses`, `injectCss` 중 하나. 차단하는 오버레이 해제, 타깃 강조 등. **Act 클래스** (승인 게이트, op `style`). 격리된 콘텐츠 월드.

### `execute_js`

인수: `tabId?`, `script` (JSON 직렬화 가능한 값을 반드시 `return` 해야 함). 구조화된 동사로 표현할 수 없는 것을 위한 탈출구. **격리된 콘텐츠 월드** 에서 실행됩니다 — DOM을 공유하지만 (그래서 `querySelector`, `element.style`이 작동함) 페이지 자체의 JS 힙/전역은 **볼 수 없습니다**. **호출당 한 번만** 승인되며 (결코 상시 부여가 아니고, Rust 드라이버에서 강제됨), 승인은 스크립트를 보여주고, 반환값은 **신뢰할 수 없음** 으로 표시되어 나중의 `act`에 결코 자동으로 공급되지 않습니다. 먼저 `query`/`style`을 선호하세요.

### `session_save` / `session_load`

인수: `tabId?`, `handle` (`[A-Za-z0-9._-]`, 1–128자). `session_save`는 탭의 세션을 `handle`로 명명된 **OS 키체인** 항목으로 스냅샷하고 값이 없는 요약 (카운트) 을 반환합니다; `session_load`는 이를 복원하고 `{loaded: true, handle}`을 반환합니다 — 확인 및 AI가 제공한 핸들일 뿐, 어떤 값도 반환하지 않습니다. `session_load`는 세션이 저장된 곳과 **같은 오리진** 을 가진 페이지에만 적용됩니다. 이는 자격 증명 **참조 방식** 입니다 (ADR-A7): AI는 저장된 세션의 이름을 지정할 뿐 쿠키/토큰 값을 결코 받지 않으며, 이들은 결코 로그되지 않습니다. 둘 다 `session` 권한이며 — **결코 상시 부여가 아니고** (호출당 승인), 한 핸들에 대한 승인은 다른 핸들에 사용될 수 없습니다. *현재 이는 `localStorage`를 다룹니다; 쿠키 캡처는 라이브 테스트 후속 작업입니다.*

### `console_clear`

인수: `tabId?`. [`browser_read`](#browser-read)의 `console`과 똑같이 `{entries: [{level, text}], url}`을 반환하며, **버퍼를 비웁니다** — 그래서 다음 읽기는 새 출력만 봅니다. 비우기는 페이지에서 `element.textContent = "[]"`을 평가하는 DOM 쓰기이므로, 다른 콘솔 읽기와 함께가 아니라 여기에 있습니다.

Shared 자세는 일치하는 `navigate` 부여가 없는 한 모든 새 오리진에 대해 목적지 승인을 요청합니다. 사람이 만든 탭은 AI 읽기/act 이전에 임시 연결 승인이 필요합니다. Sandbox 탭은 별도의 비영구 AI 쿠키 저장소를 사용합니다.

---

## `browser_read`

**읽기 전용** 절반: 탭을 바꾸지 않고 관찰합니다. `readOnlyHint: true`로 주석 처리되므로 MCP 클라이언트가 자동 승인할 수 있습니다 — 이것이 분리의 요점입니다. 이 액션들은 예전에 `browser`에 있었는데, 거기서는 하나의 도구 수준 주석이 `execute_js`까지 설명해야 했으므로 ARIA 스냅샷을 찍는 데 사람의 승인이 들었습니다.

`openWorldHint`는 `true`로 유지됩니다: 읽기 전용은 도구가 *바꾸는* 것을 설명할 뿐, 바이트를 신뢰할 수 있는지를 설명하지 않습니다. 반환되는 모든 것은 페이지가 제어하며 **신뢰할 수 없습니다** — 결과를 `browser` act 타깃으로 곧바로 되돌려 넣지 마세요.

### `read`

포커스된 브라우저 탭, 또는 `tabId`로 명명된 탭에 대해 `{url, snapshot}`을 반환합니다. `snapshot`은 `{role, name, ref}`의 ARIA 지향 목록입니다 — 각 `ref` (예: `"e5"`) 는 그 요소에 대한 안정적인 핸들이며, 현재 뷰가 유지되는 동안 유효합니다.

### `screenshot`

인수: `tabId?`. 탭의 현재 렌더링을 담은 **이미지 콘텐츠 블록** (base64 JPEG, 품질 제한) 과 페이지를 명명하는 텍스트 줄을 반환합니다 — ARIA 스냅샷이 설명할 수 없는 레이아웃과 렌더링된 상태로 향하는 시각적 채널입니다. 네이티브로 캡처되며 (`takeSnapshot`) 페이지 DOM이나 JavaScript를 읽지 않습니다. Read 클래스: `read`와 똑같이 인가됩니다 (AI 소유 탭에서 허용됨; 사람 탭은 연결이 필요하며, 캡처 시 소비됨).

### `query`

인수: `tabId?`, `selector` (CSS), 및 선택적 `fields: {attributes, box, styles:[...]}`. `{count, elements: [{ref, tag, text, …}]}`을 반환합니다 — ARIA 스냅샷이 명명할 수 없는 구조화된 DOM 데이터 (테이블, 계산된 값). **Read 클래스.** 격리된 콘텐츠 월드에서 실행됩니다.

### `extract`

인수: `tabId?`. `{title, byline, url, markdown, textLength, truncated}`을 반환합니다 — 조작이 아니라 *읽고* 싶은 페이지를 위한 **리더 모드 마크다운** 으로서의 페이지. 상한이 걸린 한 번의 캡처가 페이지의 HTML을 내보냅니다; 추출 자체는 페이지가 아니라 VMark에서 실행됩니다: 오리진에 등록된 **사이트 플러그인** 이 우선권을 가지며 (내장 Wikipedia 플러그인은 위키 크롬 — 인포박스, 내비박스, 햇노트, 편집 링크 — 을 이름으로 제거합니다), 다른 모든 사이트에는 일반 밀도 휴리스틱 리더가 대비책입니다. `truncated: true`는 페이지가 캡처 상한을 초과하여 꼬리 부분을 읽지 못했음을 의미합니다. **Read 클래스.** 반환되는 모든 것은 페이지에서 파생되었으며 신뢰할 수 없습니다.

### `workflow_status`

인수: `tabId?`, `runId` (`workflow_run`에서). `{status, completedSteps, stepCount, pausedAt?, reasonCode?, reason?, stepResults}`을 반환하며, `status`는 `running` / `paused` / `completed` / `failed` / `cancelled` 중 하나입니다. `paused` 상태는 당신이 필요한 단계를 `pausedAt`에 명명합니다. **Read 클래스** — 자유롭게 폴링하세요.

### `console`

인수: `tabId?`. `{entries: [{level, text}], url}`을 반환합니다 — 페이지의 캡처된 `console.*` 출력과 **잡히지 않은 오류 및 처리되지 않은 프로미스 거부** (`Uncaught` / `Unhandled rejection:`이 접두어로 붙은 `level: "error"` 항목으로 기록됨 — `console.*` 패칭만으로는 결코 보이지 않는 신호). Sandbox 탭 전용. 캡처는 숨겨진 DOM 버퍼에 쓰는 페이지 월드 심(shim) 으로 작동하며, 드라이버는 이를 격리된 월드에서 읽습니다 — 따라서 VMark로 되돌아가는 **메시징 채널이 열리지 않습니다** (무브리지 보장이 유지됨). 출력은 페이지가 제어하며 **신뢰할 수 없습니다** — `read`처럼 취급하고 결코 `act` 타깃으로 삼지 마세요.

버퍼는 제한된 링이므로 연속된 읽기는 겹칩니다. 읽으면서 비우려면 [`browser`](#browser)의 `console_clear`를 사용하세요 — 비우기는 페이지의 버퍼 요소에 `[]`을 쓰는 것으로, DOM 쓰기이므로 `readOnlyHint: true` 아래에 있을 수 없습니다.

### `wait`

인수: `tabId?`, 선택적 `navigationId`, 및 선택적 `timeoutMs`. 결코 탐색을 시작하지 않습니다. 버퍼링된 로드/실패 결과, `NAVIGATION_SUPERSEDED`, 또는 티켓이 제한 내에 끝나지 않으면 `TIMEOUT`을 반환합니다.

### `wait_for`

인수: `tabId?`, `ref` (읽기에서), `role` (+ 선택적 `name`), `text` (보이는 텍스트의 부분 문자열), 또는 `urlContains` (탭의 URL이 포함해야 하는 부분 문자열 — 클릭으로 유발된 탐색이 도착했는지 확인하며, 페이지 왕복 없이 탭 상태에서 응답됨) 중 정확히 하나, 그리고 선택적 `timeoutMs` (1–12,000 ms). 조건이 성립하거나 타임아웃이 경과할 때까지 폴링하고 `{matched: true|false}`을 반환합니다 (ref/role 조건의 경우 일치한 요소의 `ref` 포함) — 그래서 "찾음"과 "시간 초과"를 구분할 수 있습니다. Read 클래스. 흐름을 결정론적으로 만드는 데 사용하세요: act, 결과를 `wait_for`, 그다음 읽기.

---

## `coherence`

워크스페이스 정합성 레이어의 **읽기 전용** 뷰 — 어떤 파생 문서가 자신을 생성한 업스트림에 비해 오래되었는지 보여줍니다. 어떤 액션도 문서나 편집기 상태를 수정하지 않습니다. `status`는 읽기 전용입니다; `edges`는 먼저 조정을 수행하며 워크스페이스 원장에 출처 기록을 덧붙일 수 있지만, 문서 콘텐츠는 결코 바꾸지 않습니다. 모두 워크스페이스별 커널에서 Rust 백엔드가 전적으로 응답하므로, 편집기 창이 앞에 없어도 작동합니다.

읽기 전용 액션 두 개가 추가로 의미 레이어를 노출합니다:

- `claims` — 현재의 캐논 설정: `{claim, entryId, statement, maturity, invalidAt, visible}`. 의미 검사를 제약하는 것은 `established` 설정뿐입니다; `visible`은 default 컨텍스트를 반영합니다.
- `contexts` — 컨텍스트 집합 (암묵적인 `default`는 항상 존재합니다): `{id, name, parent, enforcement, visibleClaims, errors}`.

`readOnlyHint: true`로 주석 처리됩니다. 유일한 변경 액션인 `resolve`는 자체 도구에 있습니다 — [`coherence_resolve`](#coherence-resolve) 참조 — 덕분에 이 도구는 자동 승인 가능합니다. 설정과 컨텍스트의 변경은 아예 노출되지 않습니다: 캐논은 사람이 통제하는 상태로 남습니다.

모든 액션에는 `workspace_root`가 필요합니다: 조회할 워크스페이스의 절대 경로입니다. `session.get_state` (열린 탭의 `filePath`) 또는 workspace 도구에서 알아내세요. 누락되었거나, 절대 경로가 아니거나, 디렉터리가 아닌 경로는 일반 문자열 오류로 거부됩니다.

### `status`

한 워크스페이스의 커널 상태 카운터.

| 매개변수 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `workspace_root` | string | 예 | 조회할 워크스페이스의 절대 경로 |

**반환:**

```json
{
  "initialized": true,
  "objects": 12,
  "open_items": 2,
  "quarantined": 0,
  "writer": "0198c0de-0000-7000-8000-000000000001"
}
```

| 필드 | 의미 |
|------|------|
| `initialized` | 워크스페이스에 아직 정합성 원장이 없으면 (`.vmark/` 디렉터리 없음) `false`. 이 경우 `objects`를 제외한 모든 카운터는 0입니다. |
| `objects` | 추적 중인 객체 (정합성 식별자가 있는 파일). |
| `open_items` | 살아 있는 비최신 엣지 — 현재 내역의 크기. |
| `quarantined` | 마지막 읽기에서 격리된 잘못된 형식의 원장 라인. |
| `writer` | 이 설치본의 writer id (UUID). |

### `edges`

내역: 업스트림이 움직인 모든 살아 있는 의존성 엣지. 먼저 스캔-조정을 실행하므로 응답은 호출 시점의 디스크 파일을 반영합니다.

| 매개변수 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `workspace_root` | string | 예 | 조회할 워크스페이스의 절대 경로 |

**반환** — 배열이며, 모든 것이 정합하면 비어 있습니다:

```json
[
  {
    "txf": "0198c0de-0000-7000-8000-00000000000a",
    "input": 0,
    "upstream": "0198c0de-0000-7000-8000-00000000000b",
    "upstream_path": "characters/elena.md",
    "pinned": "rev-a1b2c3",
    "downstream": "0198c0de-0000-7000-8000-00000000000c",
    "downstream_path": "scenes/chapter-3.md",
    "downstream_rev": "rev-d4e5f6",
    "state": "version-stale"
  }
]
```

| 필드 | 의미 |
|------|------|
| `txf` / `input` | 이 엣지를 식별하는 변환 항목과 입력 슬롯 (앱 내 해결 액션에 전달). |
| `upstream` / `upstream_path` | 다운스트림이 의존하는 객체와 마지막으로 알려진 경로. |
| `pinned` | 다운스트림이 생성될 때 기반이 된 업스트림 리비전. |
| `downstream` / `downstream_path` / `downstream_rev` | 파생 객체, 그 경로, 현재 리비전. |
| `state` | `"version-stale"`, `"stale-valid"`, `"stale-contradicted"`, `"stale-unknown"`, `"waived"`, `"diverged"`, `"diverged-multi-head"`, 또는 `"unpinnable"`. |

엣지 해결 (최신 버전 수용 / 면제) 은 보통 VMark의 내역 뷰에서 수행하는 사람의 액션입니다. AI는 오직 [`coherence_resolve`](#coherence-resolve)를 통해서만, 그리고 워크스페이스 소유자가 이를 명시적으로 위임했을 때만 이를 수행할 수 있습니다.

---

## `coherence_resolve`

정합성 레이어의 **유일한 변경 액션** 으로, 자체 도구에 있어서 [`coherence`](#coherence)가 자동 승인 가능한 상태로 남을 수 있게 하고 — 그리고 되돌릴 수 없는 무언가가 다섯 개의 열거값 중 하나로 묻히는 대신 도구 목록에서 눈에 띄도록 합니다. `readOnlyHint: false, destructiveHint: true`로 주석 처리됩니다.

### `resolve`

인수: `{workspace_root, txf, input, resolution: "accept-newer" | "waive", reason? (required for waive)}`. `txf`와 `input`은 `coherence` → `edges` 행에서 옵니다.

명시적으로 위임받은 에이전트로서 살아 있는 오래된 엣지를 해소합니다. 인가는 **fail-closed** 입니다: 워크스페이스 소유자가 **당신의 인증된 브리지 신원** 에 해당 해소 종류를 포괄하는, 유효하고 만료되지 않은 위임을 (앱 안에서, 내역으로부터) 부여했어야 하며, 엣지가 여전히 살아 있어야 합니다. 위임된 모든 해소는 그 부여에 연결되어 감사 로그에 기록되며, 그 항목은 되돌릴 수 없습니다.

거부는 부여가 없거나 만료되었음을 의미합니다 — 재시도하지 말고 사용자에게 부여를 요청하세요. 이를 `coherence`에서 분리해도 어떤 보안 속성도 바뀌지 않았습니다: 인가는 항상 인증된 브리지 주체(principal) 를 기준으로 했으며, 클라이언트가 주장하는 어떤 것도 기준으로 삼지 않았습니다.

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
| `INVALID_PATH` | 봉투 | `filePath`를 읽을 수 없거나, 열린 워크스페이스 / 문서 범위를 벗어남 |
| `APPROVAL_REQUIRED` | 봉투 | **편집 자동 승인** 이 꺼진 상태에서 `save_as`로 새 위치에 저장 |
| `NOT_WORKFLOW` | 봉투 | YAML 워크플로우가 아닌 탭에서 `workflow.*`가 호출됨 |
| `READ_ONLY` | 봉투 | 읽기 전용 문서에 대해 변형이 시도됨 |
| `NO_EDITOR` | 봉투 | `selection.*`이 호출되었으나 포커스된 탭에 활성 편집기가 없음 |
| `INTERNAL` | 봉투 | 예기치 못한 핸들러 오류 |
| (일반 문자열) | 문자열 | 필수 인수 누락 또는 잘못된 타입 |
