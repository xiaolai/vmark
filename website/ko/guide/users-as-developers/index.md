# 개발자로서의 사용자

AI 코딩 도구의 시대에 "사용자"와 "개발자"의 경계가 사라지고 있습니다. 버그를 설명할 수 있다면 수정할 수 있습니다. 기능을 상상할 수 있다면 만들 수 있습니다 — 코드베이스를 이미 이해하는 AI 어시스턴트와 함께라면.

VMark는 이 철학을 수용합니다. 저장소에는 AI 코딩 도구를 위한 프로젝트 규칙, 아키텍처 문서, 규약이 미리 로드되어 있습니다. 저장소를 클론하고, AI 어시스턴트를 열고, 기여를 시작하세요 — AI는 이미 VMark가 어떻게 작동하는지 알고 있습니다.

## 시작하기

1. **저장소 클론** — AI 구성이 이미 준비되어 있습니다.
2. **AI 도구 설치** — [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), 또는 [Gemini CLI](https://github.com/google-gemini/gemini-cli).
3. **세션 열기** — 도구가 자동으로 `AGENTS.md`와 규칙을 읽습니다.
4. **코딩 시작** — AI가 프로젝트 규약, 테스트 요구 사항, 아키텍처 패턴을 알고 있습니다.

추가 설정이 필요 없습니다. AI에게 도움을 요청하기만 하면 됩니다.

## 읽기 가이드

AI 보조 개발이 처음이신가요? 이 페이지들은 서로 연결되어 있습니다:

1. **[VMark를 만든 이유](/ko/guide/users-as-developers/why-i-built-vmark)** — 비프로그래머가 스크립트에서 데스크탑 앱으로 나아간 여정
2. **[AI를 강화하는 다섯 가지 기본 인간 기술](/ko/guide/users-as-developers/what-are-indispensable)** — Git, TDD, 터미널 리터러시, 영어, 그리고 취향 — 모든 것이 구축되는 토대
3. **[비싼 모델이 더 저렴한 이유](/ko/guide/users-as-developers/why-expensive-models-are-cheaper)** — 토큰당 가격은 허상 지표; 작업당 비용이 중요한 것
4. **[구독 vs API 가격 책정](/ko/guide/users-as-developers/subscription-vs-api)** — 코딩 세션에서 정액 구독이 토큰당 요금제를 이기는 이유
5. **[영어 프롬프트가 더 잘 작동하는 이유](/ko/guide/users-as-developers/prompt-refinement)** — 번역, 정제, 그리고 `::` 훅
6. **[교차 모델 검증](/ko/guide/users-as-developers/cross-model-verification)** — 더 나은 코드를 위해 Claude + Codex를 서로 감사하는 데 사용하기
7. **[왜 PR이 아닌 이슈인가](/ko/guide/users-as-developers/why-issues-not-prs)** — AI 유지 코드베이스에서 풀 리퀘스트가 아닌 이슈를 수락하는 이유
8. **[비용 및 공수 평가](/ko/guide/users-as-developers/cost-evaluation)** —— 인간 팀이 VMark를 구축하는 비용 vs. AI 보조 개발의 실제 비용

기초가 이미 익숙하신가요? 고급 워크플로우를 위해 [교차 모델 검증](/ko/guide/users-as-developers/cross-model-verification)으로 바로 이동하거나, VMark의 AI 설정이 내부적으로 어떻게 작동하는지 계속 읽어보세요.

## 하나의 파일, 모든 도구

AI 코딩 도구는 각자의 구성 파일을 읽습니다:

| 도구 | 구성 파일 |
|------|----------|
| Claude Code | `CLAUDE.md` |
| Codex CLI | `AGENTS.md` |
| Gemini CLI | `GEMINI.md` |

동일한 지침을 세 곳에서 유지하는 것은 오류가 발생하기 쉽습니다. VMark는 단일 진실 원본으로 이를 해결합니다:

- **`AGENTS.md`** — 모든 프로젝트 규칙, 규약, 아키텍처 노트를 포함합니다.
- **`CLAUDE.md`** — 단 한 줄: `@AGENTS.md` (파일을 인라인으로 삽입하는 Claude Code 지시문).
- **Codex CLI** — `AGENTS.md`를 직접 읽습니다.
- **Gemini CLI** — `GEMINI.md`에서 `@AGENTS.md`를 사용하여 동일한 파일을 인라인으로 삽입합니다.

`AGENTS.md`를 한 번 업데이트하면 모든 도구가 변경 사항을 가져갑니다.

::: tip `@AGENTS.md`란 무엇인가요?
`@` 접두사는 다른 파일의 내용을 인라인으로 삽입하는 Claude Code 지시문입니다. C의 `#include`와 유사합니다 — `AGENTS.md`의 내용이 해당 위치에서 `CLAUDE.md`에 삽입됩니다. [agents.md](https://agents.md/)에서 자세히 알아보세요.
:::

## Codex를 제2의 의견으로 사용하기

VMark는 교차 모델 검증을 사용합니다 — Claude가 코드를 작성한 다음 Codex (OpenAI의 다른 AI 모델)가 독립적으로 감사합니다. 이것은 단일 모델이 놓칠 수 있는 맹점을 잡아냅니다. 전체 세부 사항과 설정 지침은 [교차 모델 검증](/ko/guide/users-as-developers/cross-model-verification)을 참조하세요.

## AI가 아는 것

AI 코딩 도구가 VMark 저장소를 열면 자동으로 받는 것들:

### 프로젝트 규칙 (`.claude/rules/`)

이 파일들은 모든 Claude Code 세션에 자동 로드됩니다. 다음을 다룹니다:

| 규칙 | 적용 내용 |
|------|----------|
| TDD 워크플로우 | 테스트 우선이 필수; 커버리지 임계값이 빌드를 차단 |
| 디자인 토큰 | 색상을 하드코딩하지 않음 — 전체 CSS 토큰 참조 포함 |
| 컴포넌트 패턴 | 코드 예제가 있는 팝업, 툴바, 컨텍스트 메뉴 패턴 |
| 포커스 인디케이터 | 접근성: 키보드 포커스가 항상 표시되어야 함 |
| 다크 테마 | `.dark-theme` 선택자 규칙, 토큰 동등성 요구 사항 |
| 키보드 단축키 | 3파일 동기화 절차 (Rust, TypeScript, 문서) |
| 버전 업그레이드 | 5파일 업데이트 절차 |
| 코드베이스 규약 | 스토어, 훅, 플러그인, 테스트, 임포트 패턴 |

### 커스텀 스킬

슬래시 명령어로 AI에게 특화된 기능을 제공합니다:

| 명령어 | 기능 |
|--------|------|
| `/fix` | 이슈 올바르게 수정 — 근본 원인 분석, TDD, 패치 없음 |
| `/fix-issue` | 엔드투엔드 GitHub 이슈 해결자 (가져오기, 브랜치, 수정, 감사, PR) |
| `/codex-audit` | 전체 9차원 코드 감사 (보안, 정확성, 준수, ...) |
| `/codex-audit-mini` | 소규모 변경을 위한 빠른 5차원 검사 |
| `/codex-verify` | 이전 감사에서 수정 사항 검증 |
| `/codex-commit` | 변경 분석에서 스마트 커밋 메시지 |
| `/audit-fix` | 감사, 모든 발견 사항 수정, 검증 — 완료될 때까지 반복 |
| `/feature-workflow` | 특화된 에이전트를 사용한 엔드투엔드 게이트 워크플로우 |
| `/merge-prs` | 순차적으로 열린 PR 검토 및 병합 |
| `/bump` | 모든 5개 파일에 걸쳐 버전 업그레이드, 커밋, 태그, 푸시 |

### 특화 에이전트

복잡한 작업을 위해 Claude Code는 집중된 서브에이전트에 위임할 수 있습니다:

| 에이전트 | 역할 |
|---------|------|
| 플래너 | 모범 사례 조사, 엣지 케이스 브레인스토밍, 모듈식 계획 생성 |
| 구현자 | 사전 조사를 통한 TDD 기반 구현 |
| 감사자 | 정확성과 규칙 위반에 대한 diff 검토 |
| 테스트 러너 | 게이트 실행, Tauri MCP를 통한 E2E 테스트 조율 |
| 검증자 | 릴리스 전 최종 체크리스트 |

## 개인 오버라이드

모든 것이 공유 구성에 속하는 것은 아닙니다. 개인 설정을 위해:

| 파일 | 공유? | 목적 |
|------|-------|------|
| `AGENTS.md` | 예 | 모든 AI 도구를 위한 프로젝트 규칙 |
| `CLAUDE.md` | 예 | Claude Code 진입점 |
| `.claude/settings.json` | 예 | 팀 공유 권한 |
| `CLAUDE.local.md` | **아니오** | 개인 지침 (gitignore됨) |
| `.claude/settings.local.json` | **아니오** | 개인 설정 (gitignore됨) |

본인에게만 적용되는 지침을 위해 프로젝트 루트에 `CLAUDE.local.md`를 만드세요 — 선호 언어, 워크플로우 습관, 도구 기호.
