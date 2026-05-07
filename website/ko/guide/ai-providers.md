# AI 제공자

VMark의 [AI 지니](/ko/guide/ai-genies)는 제안을 생성하기 위해 AI 제공자가 필요합니다. 로컬에 설치된 CLI 도구를 사용하거나 REST API에 직접 연결할 수 있습니다.

## 빠른 설정

가장 빠르게 시작하는 방법:

1. **설정 > 통합** 을 엽니다
2. **감지** 를 클릭하여 설치된 CLI 도구를 스캔합니다
3. CLI가 발견되면 (예: Claude, Gemini) 선택합니다 — 완료
4. CLI를 사용할 수 없는 경우 REST 제공자를 선택하고 API 키를 입력한 후 모델을 선택합니다

한 번에 하나의 제공자만 활성화할 수 있습니다.

## CLI 제공자

CLI 제공자는 로컬에 설치된 AI 도구를 사용합니다. VMark는 이를 서브프로세스로 실행하고 출력을 에디터로 스트리밍합니다.

| 제공자 | CLI 명령 | 설치 |
|--------|---------|------|
| Claude | `claude` | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) |
| Codex | `codex` | [OpenAI Codex CLI](https://github.com/openai/codex) |
| Gemini | `gemini` | [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) |

### CLI 감지 작동 방식

설정 > 통합에서 **감지** 를 클릭합니다. VMark는 각 CLI 명령에 대해 `$PATH`를 검색하고 사용 가능 여부를 보고합니다. CLI가 발견되면 해당 라디오 버튼이 선택 가능해집니다.

### 장점

- **API 키 불필요** — CLI가 기존 로그인을 사용하여 인증을 처리합니다
- **훨씬 저렴** — CLI 도구는 구독 플랜 (예: Claude Max, ChatGPT Plus/Pro, Google One AI Premium)을 사용하며, 고정 월정액이 부과됩니다. REST API 제공자는 토큰당 요금을 부과하며 많이 사용하면 10–30배 더 비쌀 수 있습니다
- **CLI 설정 활용** — 모델 기본 설정, 시스템 프롬프트, 결제는 CLI 자체에서 관리됩니다

::: tip 개발자를 위한 구독 vs API
vibe-coding에도 이 도구들을 사용 중이라면 (Claude Code, Codex CLI, Gemini CLI), 동일한 구독으로 VMark의 AI 지니와 코딩 세션을 모두 커버할 수 있습니다 — 추가 비용 없음.
:::

### 설정: Claude CLI

1. Claude Code 설치: `npm install -g @anthropic-ai/claude-code`
2. 터미널에서 `claude`를 한 번 실행하여 인증합니다
3. VMark에서 **감지** 를 클릭한 후 **Claude** 를 선택합니다

### 설정: Gemini CLI

1. Gemini CLI 설치: `npm install -g @google/gemini-cli` (또는 [공식 저장소](https://github.com/google-gemini/gemini-cli) 참조)
2. `gemini`를 한 번 실행하여 Google 계정으로 인증합니다
3. VMark에서 **감지** 를 클릭한 후 **Gemini** 를 선택합니다

## REST API 제공자

REST 제공자는 클라우드 API에 직접 연결합니다. 각각 엔드포인트, API 키, 모델명이 필요합니다.

| 제공자 | 기본 엔드포인트 | 환경 변수 |
|--------|--------------|----------|
| Anthropic | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| OpenAI | `https://api.openai.com` | `OPENAI_API_KEY` |
| Google AI | *(내장)* | `GOOGLE_API_KEY` 또는 `GEMINI_API_KEY` |
| Ollama (API) | `http://localhost:11434` | — |

### 설정 필드

REST 제공자를 선택하면 세 가지 필드가 나타납니다:

- **API 엔드포인트** — 기본 URL (고정 엔드포인트를 사용하는 Google AI는 숨겨짐)
- **API 키** — 비밀 키 (메모리에만 저장 — 디스크에는 절대 기록하지 않음)
- **모델** — 모델 식별자 (예: `claude-sonnet-4-5-20250929`, `gpt-4o`, `gemini-2.0-flash`)

### 환경 변수 자동 채우기

VMark는 실행 시 표준 환경 변수를 읽습니다. 셸 프로파일에 `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, 또는 `GEMINI_API_KEY`가 설정되어 있으면, 해당 제공자를 선택할 때 API 키 필드가 자동으로 채워집니다.

즉, `~/.zshrc` 또는 `~/.bashrc`에 한 번만 키를 설정하면 됩니다:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

그런 다음 VMark를 재시작하면 수동으로 키를 입력할 필요가 없습니다.

### 설정: Anthropic (REST)

1. [console.anthropic.com](https://console.anthropic.com)에서 API 키를 받습니다
2. VMark 설정 > 통합에서 **Anthropic** 을 선택합니다
3. API 키를 붙여넣습니다
4. 모델을 선택합니다 (기본값: `claude-sonnet-4-5-20250929`)

### 설정: OpenAI (REST)

1. [platform.openai.com](https://platform.openai.com)에서 API 키를 받습니다
2. VMark 설정 > 통합에서 **OpenAI** 를 선택합니다
3. API 키를 붙여넣습니다
4. 모델을 선택합니다 (기본값: `gpt-4o`)

### 설정: Google AI (REST)

1. [aistudio.google.com](https://aistudio.google.com)에서 API 키를 받습니다
2. VMark 설정 > 통합에서 **Google AI** 를 선택합니다
3. API 키를 붙여넣습니다
4. 모델을 선택합니다 (기본값: `gemini-2.0-flash`)

### 설정: Ollama API (REST)

로컬 Ollama 인스턴스에 REST 방식으로 액세스하거나, 네트워크의 다른 머신에서 Ollama가 실행 중일 때 사용합니다.

1. Ollama가 실행 중인지 확인합니다: `ollama serve`
2. VMark 설정 > 통합에서 **Ollama (API)** 를 선택합니다
3. 엔드포인트를 `http://localhost:11434`로 설정합니다 (또는 Ollama 호스트)
4. API 키는 비워 둡니다
5. 모델을 가져온 모델명으로 설정합니다 (예: `llama3.2`)

## 제공자 선택 가이드

| 상황 | 권장 사항 |
|------|---------|
| 이미 Claude Code가 설치되어 있음 | **Claude (CLI)** — 설정 없음, 구독 사용 |
| 이미 Codex 또는 Gemini가 설치되어 있음 | **Codex / Gemini (CLI)** — 구독 사용 |
| 프라이버시 / 오프라인 필요 | Ollama 설치 → `http://localhost:11434`에서 **Ollama (API)** |
| 커스텀 또는 자체 호스팅 모델 | **Ollama (API)** + 엔드포인트 |
| 가장 저렴한 클라우드 옵션 원함 | **모든 CLI 제공자** — 구독이 API보다 훨씬 저렴 |
| 구독 없음, 가벼운 사용만 | API 키 환경 변수 설정 → **REST 제공자** (토큰당 요금) |
| 최고 품질 출력 필요 | **Claude (CLI)** 또는 **Anthropic (REST)** + `claude-sonnet-4-5-20250929` |

## 지니별 모델 재정의

개별 지니는 `model` 프론트매터 필드를 사용하여 제공자의 기본 모델을 재정의할 수 있습니다:

```markdown
---
name: quick-fix
description: Quick grammar fix
scope: selection
model: claude-haiku-4-5-20251001
---
```

이는 강력한 기본값을 유지하면서 간단한 작업을 더 빠르고 저렴한 모델로 라우팅할 때 유용합니다.

## 안정성 및 타임아웃

VMark는 모든 제공자 호출을 보호하므로, CLI 가 응답하지 않거나 API 응답이 잘못된 경우에도 에디터가 차단되지 않습니다:

- **CLI 서브프로세스 타임아웃**: 모든 CLI 제공자 호출은 실행 타임아웃 하에서 실행됩니다. CLI 가 응답하지 않으면 VMark가 호출을 취소하고, 오류를 지니에 반환하며, 워커를 해제합니다 — 스레드 풀이 응답 없는 서브프로세스로 인해 막히지 않습니다.
- **REST JSON 파싱 안전성**: REST 제공자가 예상치 못한 응답 형태 (HTML 오류 페이지, 잘린 JSON, 업스트림 변경 후 스키마 드리프트)를 반환하면, VMark는 AI 리스너가 영구 대기하는 대신 프론트엔드에 타입이 지정된 오류를 표시합니다. 지니 상태 배너에서 재시도 옵션과 함께 오류를 확인할 수 있습니다.
- **취소 토큰**: 오래 실행되는 지니 또는 워크플로우 단계는 언제든지 취소할 수 있습니다 — 지니 선택기에서 취소하거나 패널을 닫으면 진행 중인 요청이 정상적으로 중단됩니다.
- **공유 HTTP 클라이언트**: REST 제공자는 단일 연결 풀링 `reqwest` 클라이언트를 공유하므로, 지니를 연속 실행할 때마다 TCP/TLS 핸드셰이크 비용이 발생하지 않습니다.
- **Windows 경로 검색**: Windows 에서 VMark는 CLI 를 감지할 때 사용자의 전체 `PATH` (PowerShell 전용 항목 포함)를 읽으므로, 터미널에서 동작하는 사용자 설치 도구가 VMark 내에서도 동작합니다.

## 보안 참고 사항

- **API 키는 임시** — 메모리에만 저장되며, 디스크나 `localStorage`에는 절대 기록되지 않습니다
- **환경 변수** 는 실행 시 한 번 읽혀 메모리에 캐시됩니다
- **CLI 제공자** 는 기존 CLI 인증을 사용합니다 — VMark는 자격 증명을 직접 보지 않습니다
- **모든 요청은 직접** 사용자 머신에서 제공자로 전송됩니다 — VMark 서버를 거치지 않습니다

## 문제 해결

**"AI 제공자 없음"** — **감지** 를 클릭하여 CLI를 스캔하거나, API 키와 함께 REST 제공자를 구성합니다.

**CLI에 "찾을 수 없음" 표시** — CLI가 `$PATH`에 없습니다. 설치하거나 셸 프로파일을 확인하세요. macOS에서 GUI 앱은 터미널 `$PATH`를 상속받지 않을 수 있습니다 — `/etc/paths.d/`에 경로를 추가해 보세요.

**CLI 가 응답하지 않음 / 응답 없음** — VMark의 실행 타임아웃이 자동으로 호출을 취소하며, 지니 상태 배너에 오류가 표시됩니다. 특정 CLI 가 계속 타임아웃에 걸린다면, 터미널에서 직접 실행하여 정상 동작을 확인한 후 인터랙티브 인증이 필요한지 확인하세요.

**REST 제공자에서 401 반환** — API 키가 유효하지 않거나 만료되었습니다. 제공자 콘솔에서 새 키를 생성하세요.

**REST 제공자에서 429 반환** — 속도 제한에 도달했습니다. 잠시 기다렸다가 다시 시도하거나 다른 제공자로 전환하세요.

**REST 제공자가 잘못된 / 예상치 못한 JSON 반환** — VMark가 타입이 지정된 파싱 오류를 표시합니다 (예: "list_models returned an unexpected response shape"). 엔드포인트 URL 과 선택한 제공자 유형에 맞는 API 계약을 확인하세요. 일부 자체 호스팅 게이트웨이는 OpenAI 호환 URL 을 광고하지만 다른 스키마를 사용합니다.

**응답이 느림** — CLI 제공자는 서브프로세스 오버헤드가 있습니다. 더 빠른 응답을 위해서는 직접 연결하는 REST 제공자를 사용하세요. 가장 빠른 로컬 옵션은 소형 모델의 Ollama를 사용하는 것입니다.

**모델을 찾을 수 없음 오류** — 모델 식별자가 제공자의 제공 목록과 일치하지 않습니다. 유효한 모델명은 제공자의 문서를 확인하세요.

## 참고 항목

- [AI 지니](/ko/guide/ai-genies) — AI 기반 글쓰기 지원 사용 방법
- [MCP 설정](/ko/guide/mcp-setup) — Model Context Protocol을 통한 외부 AI 통합
