# AI 통합 (MCP)

VMark에는 Claude와 같은 AI 어시스턴트가 에디터와 직접 상호작용할 수 있게 해주는 내장 MCP (Model Context Protocol) 서버가 포함되어 있습니다.

## MCP란?

[Model Context Protocol](https://modelcontextprotocol.io/)은 AI 어시스턴트가 외부 도구 및 애플리케이션과 상호작용할 수 있게 해주는 개방형 표준입니다. VMark의 MCP 서버는 에디터 기능을 AI 어시스턴트가 다음과 같은 작업에 사용할 수 있는 도구로 노출합니다:

- 문서 내용 읽기 및 쓰기
- 서식 적용 및 구조 생성
- 문서 탐색 및 관리
- 특수 콘텐츠 삽입 (수학, 다이어그램, 위키 링크)

## 빠른 설정

VMark는 원클릭 설치로 AI 어시스턴트 연결을 쉽게 만들어 줍니다.

### 1. MCP 서버 활성화

**설정 → 통합** 을 열고 MCP 서버를 활성화합니다:

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-server.png" alt="VMark MCP Server Settings" />
</div>

- **MCP 서버 활성화** - AI 연결을 허용하려면 켭니다
- **시작 시 실행** - VMark 열 때 자동 시작
- **편집 자동 승인** - AI 변경 사항을 미리보기 없이 적용 (아래 참조)

### 2. 설정 설치

AI 어시스턴트에 맞는 **설치** 를 클릭합니다:

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-install.png" alt="VMark MCP Install Configuration" />
</div>

지원되는 AI 어시스턴트:
- **Claude Desktop** - Anthropic의 데스크톱 앱
- **Claude Code** - 개발자용 CLI
- **Codex CLI** - OpenAI의 코딩 어시스턴트
- **Gemini CLI** - Google의 AI 어시스턴트

::: info 기타 MCP 호환 클라이언트
Cursor, Windsurf 등 기타 MCP 호환 클라이언트도 VMark의 MCP 서버에 연결할 수 있습니다. MCP 서버 바이너리 경로를 지정하여 수동으로 구성하세요 (아래 [수동 설정](#수동-설정) 참조).
:::

#### 상태 아이콘

각 제공자에 상태 표시기가 표시됩니다:

| 아이콘 | 상태 | 의미 |
|--------|------|------|
| ✓ 초록 | 유효 | 설정이 올바르고 작동 중 |
| ⚠ 황색 | 경로 불일치 | VMark가 이동됨 — **복구** 클릭 |
| ✗ 빨강 | 바이너리 없음 | MCP 바이너리를 찾을 수 없음 — VMark 재설치 |
| ○ 회색 | 미설정 | 설치되지 않음 — **설치** 클릭 |

::: tip VMark를 이동했나요?
VMark.app을 다른 위치로 이동하면 상태가 황색 "경로 불일치"로 표시됩니다. **복구** 버튼을 클릭하기만 하면 새 경로로 설정이 업데이트됩니다.
:::

### 3. AI 어시스턴트 재시작

설치 또는 복구 후, **AI 어시스턴트를 완전히 재시작** 하세요 (종료 후 다시 열기). 새 설정을 로드합니다. VMark는 각 설정 변경 후 알림을 표시합니다.

### 4. 사용해 보기

AI 어시스턴트에서 다음과 같은 명령을 시도해 보세요:
- *"VMark 문서에 무엇이 있나요?"*
- *"양자 컴퓨팅 요약을 VMark에 작성해 주세요"*
- *"문서에 목차를 추가해 주세요"*

## 실제 사용 예시

Claude에게 질문하고 답변을 VMark 문서에 직접 작성하도록 합니다:

<div class="screenshot-container">
  <img src="/screenshots/mcp-claude.png" alt="Claude Desktop using VMark MCP" />
  <p class="screenshot-caption">Claude Desktop이 <code>document</code> → <code>set_content</code>를 호출하여 VMark에 씁니다</p>
</div>

<div class="screenshot-container">
  <img src="/screenshots/mcp-result.png" alt="Content rendered in VMark" />
  <p class="screenshot-caption">콘텐츠가 VMark에 즉시 나타나며 완전히 서식이 적용됩니다</p>
</div>

<!-- Styles in style.css -->

## 수동 설정

수동으로 설정하려면 다음 설정 파일 위치를 참조하세요:

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) 또는 `%APPDATA%\Claude\claude_desktop_config.json` (Windows)를 편집합니다:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Claude Code

`~/.claude.json` 또는 프로젝트의 `.mcp.json`을 편집합니다:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Codex CLI

`~/.codex/config.toml`을 편집합니다:

```toml
[mcp_servers.vmark]
command = "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
```

### Gemini CLI

`~/.gemini/settings.json`을 편집합니다:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

::: tip 바이너리 경로 찾기
macOS에서 MCP 서버 바이너리는 VMark.app 내부에 있습니다:
- `VMark.app/Contents/MacOS/vmark-mcp-server`

Windows:
- `C:\Program Files\VMark\vmark-mcp-server.exe`

Linux:
- `/usr/bin/vmark-mcp-server` (또는 설치 위치)

포트는 자동으로 검색됩니다 — `args`는 필요하지 않습니다.
:::

### CLI 플래그 (고급)

MCP 서버 바이너리는 진단 및 레거시 설정을 위한 몇 가지 플래그를 지원합니다:

| 플래그 | 설명 |
|---|---|
| `--version` (또는 `-v`) | 버전을 출력하고 종료합니다 (실행 중인 VMark 와 일치해야 합니다). |
| `--health-check` | 실행 중인 VMark 브리지를 대상으로 자가 테스트를 실행하고 종료합니다. AI 어시스턴트를 연결하기 전에 설치 상태를 검증할 때 사용합니다. |
| `--port <번호>` | 수동 포트 재정의. 자동 검색 핸드셰이크를 건너뛰고 지정된 포트에 연결합니다. 브리지 포트가 외부에서 고정된 레거시 설정에서만 유용합니다. 자동 검색 방식을 권장합니다. |

예시:

```bash
vmark-mcp-server --health-check
vmark-mcp-server --version
vmark-mcp-server --port 9223   # 레거시 / 수동
```

## 작동 방식

```text
AI 어시스턴트 <--stdio--> MCP 서버 <--WebSocket--> VMark 에디터
```

1. **VMark가 WebSocket 브리지를 시작** 합니다 — 실행 시 사용 가능한 포트에서
2. **MCP 서버** 가 VMark의 앱 데이터 디렉터리에서 포트와 인증 토큰을 읽습니다
3. **MCP 서버** 가 WebSocket 브리지를 통해 연결 및 인증합니다
4. **AI 어시스턴트** 는 stdio를 통해 MCP 서버와 통신합니다
5. **명령이 브리지를 통해** VMark 에디터로 전달됩니다

## 사용 가능한 기능

연결되면 AI 어시스턴트는 다음을 수행할 수 있습니다:

| 카테고리 | 기능 |
|----------|------|
| **문서** | 내용 읽기/쓰기, 검색, 바꾸기 |
| **선택** | 선택 가져오기/설정, 선택 텍스트 바꾸기 |
| **서식** | 굵게, 기울임꼴, 코드, 링크 등 |
| **블록** | 제목, 단락, 코드 블록, 인용문 |
| **목록** | 글머리 기호, 번호, 작업 목록 |
| **테이블** | 행/열 삽입 및 수정 |
| **특수** | 수식, Mermaid 다이어그램, 위키 링크 |
| **워크스페이스** | 문서 열기/저장, 창 관리 |

전체 문서는 [MCP 도구 참조](/ko/guide/mcp-tools)를 참조하세요.

## MCP 상태 확인

VMark는 MCP 서버 상태를 확인하는 여러 방법을 제공합니다:

### 상태 표시줄 표시기

상태 표시줄 오른쪽에 **MCP** 표시기가 표시됩니다:

| 색상 | 상태 |
|------|------|
| 초록 | 연결됨 및 실행 중 |
| 회색 | 연결 끊김 또는 중지됨 |
| 깜빡임 (애니메이션) | 시작 중 |

시작은 보통 1-2초 내에 완료됩니다.

표시기를 클릭하면 자세한 상태 대화상자가 열립니다.

### 상태 대화상자

**도움말 → MCP 서버 상태** 를 통해 접근하거나 상태 표시줄 표시기를 클릭합니다.

대화상자에는 다음이 표시됩니다:
- 연결 상태 (정상 / 오류 / 중지됨)
- 브리지 실행 상태 및 포트
- 서버 버전
- 사용 가능한 도구 (12개) 및 리소스 (4개)
- 마지막 상태 확인 시간
- 복사 버튼이 있는 사용 가능한 도구 전체 목록

### 설정 패널

**설정 → 통합** 에서 서버가 실행 중이면 다음이 표시됩니다:
- 버전 번호
- 도구 및 리소스 개수
- **연결 테스트** 버튼 — 상태 확인 실행
- **세부 정보 보기** 버튼 — 상태 대화상자 열기

## 문제 해결

### "연결 거부" 또는 "활성 에디터 없음"

- VMark가 실행 중이고 문서가 열려 있는지 확인합니다
- 설정 → 통합에서 MCP 서버가 활성화되어 있는지 확인합니다
- MCP 브리지가 "실행 중" 상태인지 확인합니다
- 연결이 끊어진 경우 VMark를 재시작합니다

### VMark 이동 후 경로 불일치

VMark.app을 다른 위치로 이동한 경우 (예: 다운로드에서 응용 프로그램으로), 설정이 이전 경로를 가리킵니다:

1. **설정 → 통합** 을 엽니다
2. 영향을 받는 제공자 옆의 황색 ⚠ 경고 아이콘을 찾습니다
3. **복구** 를 클릭하여 경로를 업데이트합니다
4. AI 어시스턴트를 재시작합니다

### AI 어시스턴트에 도구가 표시되지 않음

- 설정 설치 후 AI 어시스턴트를 재시작합니다
- 설정이 설치되었는지 확인합니다 (설정에서 초록 체크 표시 확인)
- AI 어시스턴트의 로그에서 MCP 연결 오류를 확인합니다

### "활성 에디터 없음"으로 명령 실패

- VMark에서 문서 탭이 활성 상태인지 확인합니다
- 에디터 영역을 클릭하여 포커스를 줍니다
- 일부 명령은 먼저 텍스트를 선택해야 합니다

## 제안 시스템 및 자동 승인

기본적으로 AI 어시스턴트가 문서를 수정할 때 (삽입, 바꾸기, 삭제), VMark는 승인이 필요한 **제안** 을 생성합니다:

- **삽입** — 새 텍스트가 고스트 텍스트 미리보기로 표시됩니다
- **바꾸기** — 원래 텍스트에 취소선이 그어지고 새 텍스트가 고스트 텍스트로 표시됩니다
- **삭제** — 제거할 텍스트에 취소선이 표시됩니다

**Enter** 를 눌러 수락하거나 **Escape** 를 눌러 거부합니다. 이는 실행 취소/다시 실행 기록을 보존하고 완전한 제어권을 제공합니다.

### 자동 승인 모드

::: warning 주의해서 사용하세요
**편집 자동 승인** 을 활성화하면 제안 미리보기를 건너뛰고 AI 변경 사항을 즉시 적용합니다. AI 어시스턴트를 신뢰하고 더 빠른 편집을 원할 때만 활성화하세요.
:::

자동 승인이 활성화되면:
- 변경 사항이 미리보기 없이 직접 적용됩니다
- 실행 취소 (Mod+Z)가 여전히 변경 사항을 되돌릴 수 있습니다
- 응답 메시지에 "(자동 승인됨)"이 포함됩니다

이 설정은 다음 경우에 유용합니다:
- 빠른 AI 지원 글쓰기 워크플로우
- 잘 정의된 작업이 있는 신뢰할 수 있는 AI 어시스턴트
- 각 변경 사항 미리보기가 비실용적인 일괄 작업

## 보안 참고 사항

- MCP 서버는 로컬 연결만 허용합니다 (localhost)
- 외부 서버로 데이터가 전송되지 않습니다
- 모든 처리가 사용자 머신에서 이루어집니다
- WebSocket 브리지는 로컬에서만 접근 가능합니다
- 의도하지 않은 변경을 방지하기 위해 자동 승인은 기본적으로 비활성화됩니다

## 다음 단계

- 사용 가능한 모든 [MCP 도구](/ko/guide/mcp-tools) 탐색하기
- [키보드 단축키](/ko/guide/shortcuts) 알아보기
- 다른 [기능](/ko/guide/features) 확인하기
