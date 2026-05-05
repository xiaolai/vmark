<script setup>
// Skip Vue template processing for the whole page so ${{ }} expressions
// in code spans and fenced YAML blocks don't get interpreted.
</script>

<div v-pre>

# 워크플로 지니

VMark 지니에는 두 가지 종류가 있습니다.

- **마크다운 지니** (`.md`) — 일회성 프롬프트 템플릿. 원래의 지니 형식입니다. [AI 지니](/ko/guide/ai-genies)를 참고하세요.
- **워크플로 지니** (`.yml` / `.yaml`) — 명시적인 데이터 흐름으로 마크다운 지니를 연결하는 다단계 파이프라인입니다.

두 형식 모두 동일한 전역 지니 디렉터리에 위치하며 같은 피커(`Cmd+Y`)에 표시됩니다. 워크플로 지니는 일반 지니 항목으로 표시되며, 선택하면 일회성 AI 호출 대신 워크플로 러너가 실행됩니다.

## 어느 쪽을 사용해야 할까요

| 필요 | 형식 |
|------|--------|
| 단일 변환 (재작성, 번역, 요약) | 마크다운 |
| 개요 → 초안 → 다듬기 파이프라인 | 워크플로 |
| 단계별로 다른 AI 모델 사용 | 워크플로 |
| 승인 게이트가 필요한 단계 | 워크플로 |
| 한 단계의 출력이 다음 단계에 입력으로 사용 | 워크플로 |

단일 프롬프트로 충분하다면 마크다운 지니를 사용하세요. 단계 구성, 구조화된 데이터 흐름 또는 사람이 개입하는 승인이 필요하다면 워크플로를 사용하세요.

## 파일 형식

워크플로 지니는 YAML 파일입니다. 최상위 필드는 다음과 같습니다.

| 필드 | 필수 | 용도 |
|-------|----------|---------|
| `name` | 예 | 사람이 읽을 수 있는 레이블. 피커는 **파일 이름**을 표시 이름으로 사용합니다. 이 필드는 `description:`이 설정되지 않은 경우 설명으로 표시됩니다. |
| `description` | 아니요 | 피커에 표시되는 한 줄 요약입니다. |
| `defaults` | 아니요 | 모든 단계에 적용되는 기본 모델 / 승인 / 제한입니다. |
| `env` | 아니요 | `${VAR}` 또는 `${{ env.NAME }}`으로 사용할 수 있는 환경 변수입니다. |
| `steps` | 예 | 단계의 정렬된 목록입니다. |

### 단계 구조

```yaml
- id: my-step
  uses: genie/<name>     # or action/<name>
  with:
    input: "text or expression"
  needs: prior-step      # optional; can also be a list
  approval: ask          # optional; "auto" (default) or "ask"
  model: claude-sonnet   # optional; overrides defaults
  limits:
    timeout: 120s        # default 300s
    max_tokens: 4096     # REST providers only
```

### 단계 유형

| `uses:` 접두사 | 동작 |
|----------------|----------|
| `genie/<name>` | 일치하는 마크다운 지니를 로드하고, 단계의 `with:` 맵으로 템플릿을 채운 다음 활성 AI 제공업체를 호출합니다. 마크다운 지니의 `{{content}}` / `{{input}}` 자리 표시자는 `with.input`을 자동으로 가져옵니다. |
| `action/read-file` | 워크스페이스 상대 경로를 읽습니다. 출력은 파일 본문입니다. |
| `action/save-file` | `with.input`을 `with.path`에 씁니다. |
| `action/notify` | `with.message`를 기록합니다. |
| `action/copy` | `with.input`을 변경 없이 반환합니다 (체이닝에 유용). |

### 표현식

모든 `with:` 값 내부에서:

| 구문 | 해석 결과 |
|--------|-------------|
| `${{ steps.ID.outputs.FIELD }}` | 이전 단계의 특정 출력 필드. |
| `${{ steps.ID.output }}` | 이전 단계의 `outputs.text`에 대한 단축 표기. |
| `${{ env.NAME }}` | 워크플로 `env:` 값. |
| `${VAR}` | 위와 동일, 레거시 형식. |
| `stepId.output` (전체 문자열) | `${{ steps.stepId.output }}`의 레거시 별칭. |

알 수 없는 단계 / 필드 참조는 AI 호출 전에 매개변수 해석 시점에 단계를 실패시킵니다.

### 템플릿 바인딩

`genie/<name>` 단계가 실행될 때, 해당 마크다운 지니의 프롬프트 템플릿은 다음 규칙에 따라 채워집니다.

- `{{input}}` → `with.input`
- `{{content}}` → `with.content`가 있으면 그 값, 없으면 `with.input` (둘 다 없으면 치명적 오류)
- `{{context}}` → `with.context`가 있으면 그 값, 없으면 빈 문자열 (치명적이지 않음)
- `{{any-other-key}}` → `with.<key>` (없으면 치명적 오류)

이는 곧 **기존 마크다운 지니가 워크플로에서도 변경 없이 작동**한다는 뜻입니다 — `with: { input: "..." }`로 호출하면 `{{content}}` 자리 표시자가 별칭 체인을 통해 값을 가져옵니다.

### 승인 게이트

단계에 `approval: ask` (또는 워크플로 `defaults.approval: ask`)가 있으면 러너가 일시 중지되며, 해석된 프롬프트 미리보기와 모델을 보여주는 대화상자를 열고 사용자의 결정을 기다린 후 제공업체를 호출합니다. Esc는 거부를 의미합니다. 시간 제한은 단계의 `limits.timeout`과 10분 중 더 짧은 쪽입니다.

## 샘플

VMark는 번들된 지니에 `outline-and-polish.yml` 샘플 워크플로를 포함합니다. 사용자 지니 디렉터리에 복사하여 커스터마이즈하세요.

```yaml
name: Outline and Polish
description: Generate an outline, then polish the output for clarity.

defaults:
  approval: auto

steps:
  - id: outline
    uses: genie/outline
    with:
      input: "Replace this seed with your topic."

  - id: polish
    uses: genie/polish
    needs: outline
    with:
      input: ${{ steps.outline.outputs.text }}
```

`genie/outline`은 구조화된 개요를 생성하고, `polish` 단계는 그 출력을 명료하게 다시 작성합니다. 두 `genie/*` 참조는 번들된 마크다운 지니인 `structure/outline.md`와 `editing/polish.md`로 해석됩니다.

## 취소, 시간 제한, 한도

- **취소** — 워크플로 사이드 패널에서 정지를 클릭합니다. 러너는 진행 중인 모든 CLI 제공업체 자식 프로세스를 한 틱 안에 종료하고 진행 중인 REST 요청을 중단합니다.
- **단계별 시간 제한** — `tokio::time::timeout(step.limits.timeout)`로 감싸집니다. 시간이 초과되면 단계는 "Timed out after Xs"로 실패하고 다운스트림 단계는 건너뜁니다.
- **출력 상한** — 단일 단계의 출력은 5 MB로 제한됩니다. 폭주하는 제공업체는 취소를 트리거하고 "Provider output exceeded 5 MB cap"이 표시됩니다.

## 관련 문서

- [AI 지니](/ko/guide/ai-genies) — 마크다운 지니 형식과 작성법.
- [워크플로 뷰어](/ko/guide/workflow-viewer) — 여기서 사용된 것과 동일한 React Flow 사이드 패널로, 원래는 GitHub Actions 워크플로용이었습니다.

</div>
